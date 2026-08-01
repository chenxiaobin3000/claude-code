import {
  createMcpSocketClient,
  SocketConnectionError,
} from './mcpSocketClient.js'
import type { McpSocketClient } from './mcpSocketClient.js'
import type { ChromeSocketEndpoint } from '../protocol/index.js'
import type {
  ClaudeForChromeContext,
  PermissionMode,
  PermissionOverrides,
} from './types.js'

export function chromeTabRouteKey(profileId: string, tabId: number): string {
  return `${profileId}\u0000${tabId}`
}

export function selectChromeEndpointId(
  args: Record<string, unknown>,
  endpoints: readonly ChromeSocketEndpoint[],
  tabRoutes: ReadonlyMap<string, string>,
): string | undefined {
  const profileId =
    typeof args.profileId === 'string' && args.profileId.length > 0
      ? args.profileId
      : undefined
  if (profileId) {
    const matches = endpoints.filter(item => item.profileId === profileId)
    if (matches.length === 0) {
      throw new SocketConnectionError(
        `Chrome profile ${profileId} is not connected. Refresh tabs_context_mcp before retrying.`,
      )
    }
    if (matches.length > 1) {
      throw new SocketConnectionError(
        `Chrome profile ID ${profileId} is duplicated across multiple extension instances. Reinstall the extension in one affected profile before continuing.`,
      )
    }
    return matches[0]!.id
  }

  const tabId = typeof args.tabId === 'number' ? args.tabId : undefined
  if (tabId !== undefined) {
    const matchingEndpointIds = [
      ...new Set(
        [...tabRoutes.entries()]
          .filter(([key]) => key.endsWith(`\u0000${tabId}`))
          .map(([, endpointId]) => endpointId),
      ),
    ]
    if (matchingEndpointIds.length === 1) return matchingEndpointIds[0]
    if (matchingEndpointIds.length > 1) {
      throw new SocketConnectionError(
        `Tab ID ${tabId} exists in multiple Chrome profiles. Pass profileId from tabs_context_mcp.`,
      )
    }
  }

  if (endpoints.length === 1) return endpoints[0]!.id
  if (endpoints.length > 1) {
    throw new SocketConnectionError(
      'Multiple Chrome profiles are connected. Pass profileId from tabs_context_mcp; no profile was selected automatically.',
    )
  }
  return undefined
}

/**
 * Manages plugin-local connections to Chrome native host sockets.
 * Routes tool calls to the correct socket based on tab ID.
 *
 * For `tabs_context_mcp`: queries all connected sockets and merges results.
 * For other tools: routes based on the `tabId` argument using a routing table
 * built from tabs_context_mcp responses.
 */
export class McpSocketPool {
  private clients: Map<string, McpSocketClient> = new Map()
  private endpoints: Map<string, ChromeSocketEndpoint> = new Map()
  private tabRoutes: Map<string, string> = new Map()
  private context: ClaudeForChromeContext
  private notificationHandler:
    | ((notification: {
        method: string
        params?: Record<string, unknown>
      }) => void)
    | null = null

  constructor(context: ClaudeForChromeContext) {
    this.context = context
  }

  public setNotificationHandler(
    handler: (notification: {
      method: string
      params?: Record<string, unknown>
    }) => void,
  ): void {
    this.notificationHandler = handler
    for (const client of this.clients.values()) {
      client.setNotificationHandler(handler)
    }
  }

  /**
   * Discover available sockets and ensure at least one is connected.
   */
  public async ensureConnected(): Promise<boolean> {
    const { logger, serverName } = this.context

    this.refreshClients()

    // Try to connect any disconnected clients
    const connectPromises: Promise<boolean>[] = []
    for (const client of this.clients.values()) {
      if (!client.isConnected()) {
        connectPromises.push(client.ensureConnected().catch(() => false))
      }
    }

    if (connectPromises.length > 0) {
      await Promise.all(connectPromises)
    }

    const connectedCount = this.getConnectedClients().length
    if (connectedCount === 0) {
      logger.info(`[${serverName}] No connected sockets in pool`)
      return false
    }

    logger.info(`[${serverName}] Socket pool: ${connectedCount} connected`)
    return true
  }

  /**
   * Call a tool, routing to the correct socket based on tab ID.
   * For tabs_context_mcp, queries all sockets and merges results.
   */
  public async callTool(
    name: string,
    args: Record<string, unknown>,
    _permissionOverrides?: PermissionOverrides,
  ): Promise<unknown> {
    if (name === 'tabs_context_mcp') {
      return this.callTabsContext(args)
    }

    const connected = this.getConnectedEntries()
    const endpointId = selectChromeEndpointId(
      args,
      connected.map(entry => entry.endpoint),
      this.tabRoutes,
    )
    if (!endpointId) {
      throw new SocketConnectionError(
        `[${this.context.serverName}] No connected sockets available`,
      )
    }
    const client = this.clients.get(endpointId)
    if (!client?.isConnected()) {
      throw new SocketConnectionError(
        `[${this.context.serverName}] Selected Chrome profile disconnected before the tool call`,
      )
    }
    return client.callTool(name, args)
  }

  public async setPermissionMode(
    mode: PermissionMode,
    allowedDomains?: string[],
  ): Promise<void> {
    const connected = this.getConnectedClients()
    await Promise.all(
      connected.map(client => client.setPermissionMode(mode, allowedDomains)),
    )
  }

  public isConnected(): boolean {
    return this.getConnectedClients().length > 0
  }

  public disconnect(): void {
    for (const client of this.clients.values()) {
      client.disconnect()
    }
    this.clients.clear()
    this.endpoints.clear()
    this.tabRoutes.clear()
  }

  private getConnectedClients(): McpSocketClient[] {
    return [...this.clients.values()].filter(c => c.isConnected())
  }

  private getConnectedEntries(): Array<{
    endpoint: ChromeSocketEndpoint
    client: McpSocketClient
  }> {
    const entries: Array<{
      endpoint: ChromeSocketEndpoint
      client: McpSocketClient
    }> = []
    for (const [endpointId, client] of this.clients) {
      const endpoint = this.endpoints.get(endpointId)
      if (endpoint && client.isConnected()) entries.push({ endpoint, client })
    }
    return entries
  }

  /**
   * Query all connected sockets for tabs and merge results.
   * Updates the tab routing table.
   */
  private async callTabsContext(
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const { logger, serverName } = this.context
    const requestedProfileId =
      typeof args.profileId === 'string' && args.profileId.length > 0
        ? args.profileId
        : undefined
    const connected = this.getConnectedEntries().filter(
      entry =>
        !requestedProfileId || entry.endpoint.profileId === requestedProfileId,
    )

    if (connected.length === 0) {
      throw new SocketConnectionError(
        requestedProfileId
          ? `[${serverName}] Chrome profile ${requestedProfileId} is not connected`
          : `[${serverName}] No connected Chrome profiles are available`,
      )
    }

    const results = await Promise.allSettled(
      connected.map(async ({ client, endpoint }) => {
        const result = await client.callTool('tabs_context_mcp', args)
        return { result, endpoint }
      }),
    )

    const mergedTabs: Array<Record<string, unknown>> = []
    const profiles: Array<{ profileId: string; profileName: string }> = []
    this.tabRoutes.clear()

    for (const settledResult of results) {
      if (settledResult.status !== 'fulfilled') {
        logger.info(
          `[${serverName}] tabs_context_mcp failed on one socket: ${settledResult.reason}`,
        )
        continue
      }

      const { result, endpoint } = settledResult.value
      this.updateTabRoutes(result, endpoint)
      profiles.push({
        profileId: endpoint.profileId,
        profileName: endpoint.profileName,
      })

      const tabs = this.extractTabs(result)
      if (tabs) {
        for (const tab of tabs) {
          if (typeof tab !== 'object' || tab === null) continue
          mergedTabs.push({
            ...(tab as Record<string, unknown>),
            profileId: endpoint.profileId,
            profileName: endpoint.profileName,
          })
        }
      }
    }

    if (profiles.length === 0) {
      throw new SocketConnectionError(
        `[${serverName}] All Chrome profiles failed for tabs_context_mcp`,
      )
    }

    const tabListText = mergedTabs
      .map(tab => {
        return `  • [${String(tab.profileName)} | ${String(tab.profileId)}] tabId ${String(tab.tabId)}: "${String(tab.title)}" (${String(tab.url)})`
      })
      .join('\n')

    return {
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ profiles, availableTabs: mergedTabs }),
          },
          {
            type: 'text',
            text: `\n\nChrome Profiles:\n${profiles
              .map(
                profile => `  • ${profile.profileName}: ${profile.profileId}`,
              )
              .join(
                '\n',
              )}\nAvailable tabs:\n${tabListText || '  • No tabs in the selected profile(s)'}`,
          },
        ],
      },
    }
  }

  /**
   * Extract tab objects from a tool response to update routing table.
   */
  private updateTabRoutes(
    result: unknown,
    endpoint: ChromeSocketEndpoint,
  ): void {
    const tabs = this.extractTabs(result)
    if (!tabs) return

    for (const tab of tabs) {
      if (typeof tab === 'object' && tab !== null && 'tabId' in tab) {
        const tabId = (tab as { tabId: number }).tabId
        this.tabRoutes.set(
          chromeTabRouteKey(endpoint.profileId, tabId),
          endpoint.id,
        )
      }
    }
  }

  private extractTabs(result: unknown): unknown[] | null {
    if (!result || typeof result !== 'object') return null

    // Response format: { result: { content: [{ type: "text", text: "{\"availableTabs\":[...],\"tabGroupId\":...}" }] } }
    const asResponse = result as {
      result?: { content?: Array<{ type: string; text?: string }> }
    }
    const content = asResponse.result?.content
    if (!content || !Array.isArray(content)) return null

    for (const item of content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text)
          if (Array.isArray(parsed)) return parsed
          // Handle { availableTabs: [...] } format
          if (parsed && Array.isArray(parsed.availableTabs)) {
            return parsed.availableTabs
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
    return null
  }

  /**
   * Scan for available sockets and create/remove clients as needed.
   */
  private refreshClients(): void {
    const endpoints = this.getAvailableEndpoints()
    const endpointIds = new Set(endpoints.map(endpoint => endpoint.id))
    const { logger, serverName } = this.context

    // Add new clients for newly discovered sockets
    for (const endpoint of endpoints) {
      this.endpoints.set(endpoint.id, endpoint)
      if (!this.clients.has(endpoint.id)) {
        logger.info(
          `[${serverName}] Adding Chrome TCP endpoint to pool: ${endpoint.id}`,
        )
        const clientContext: ClaudeForChromeContext = {
          ...this.context,
          endpoint,
          getEndpoints: undefined,
        }
        const client = createMcpSocketClient(clientContext)
        client.disableAutoReconnect = true
        if (this.notificationHandler) {
          client.setNotificationHandler(this.notificationHandler)
        }
        this.clients.set(endpoint.id, client)
      }
    }

    // Remove clients for sockets that no longer exist
    for (const [endpointId, client] of this.clients.entries()) {
      if (!endpointIds.has(endpointId)) {
        logger.info(
          `[${serverName}] Removing stale Chrome TCP endpoint: ${endpointId}`,
        )
        client.disconnect()
        this.clients.delete(endpointId)
        this.endpoints.delete(endpointId)
        for (const [tabId, routeEndpointId] of this.tabRoutes.entries()) {
          if (routeEndpointId === endpointId) {
            this.tabRoutes.delete(tabId)
          }
        }
      }
    }
  }

  private getAvailableEndpoints(): ChromeSocketEndpoint[] {
    return this.context.getEndpoints?.() ?? []
  }
}

export function createMcpSocketPool(
  context: ClaudeForChromeContext,
): McpSocketPool {
  return new McpSocketPool(context)
}
