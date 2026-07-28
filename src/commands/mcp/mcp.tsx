import React, { useEffect, useRef, useState } from 'react';
import { MCPSettings } from '../../components/mcp/index.js';
import { MCPReconnect } from '../../components/mcp/MCPReconnect.js';
import { Spinner } from '../../components/Spinner.js';
import { Box, Link, Text } from '@anthropic/ink';
import {
  useMcpLogoutDisconnect,
  useMcpReconnect,
  useMcpToggleEnabled,
} from '../../services/mcp/MCPConnectionManager.js';
import {
  AuthenticationCancelledError,
  performMCPOAuthFlow,
  revokeServerTokens,
} from '../../services/mcp/auth.js';
import {
  clearMcpAuthCache,
} from '../../services/mcp/client.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { PluginSettings } from '../plugin/PluginSettings.js';

// TODO: This is a hack to get the context value from toggleMcpServer (useContext only works in a component)
// Ideally, all MCP state and functions would be in global state.
function MCPToggle({
  action,
  target,
  onComplete,
}: {
  action: 'enable' | 'disable';
  target: string;
  onComplete: (result: string) => void;
}): null {
  const mcpClients = useAppState(s => s.mcp.clients);
  const toggleMcpServer = useMcpToggleEnabled();
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const isEnabling = action === 'enable';
    const clients = mcpClients.filter(c => c.name !== 'ide');
    const toToggle =
      target === 'all'
        ? clients.filter(c => (isEnabling ? c.type === 'disabled' : c.type !== 'disabled'))
        : clients.filter(c => c.name === target);

    if (toToggle.length === 0) {
      onComplete(
        target === 'all'
          ? `All MCP servers are already ${isEnabling ? 'enabled' : 'disabled'}`
          : `MCP server "${target}" not found`,
      );
      return;
    }

    for (const s of toToggle) {
      void toggleMcpServer(s.name);
    }

    onComplete(
      target === 'all'
        ? `${isEnabling ? 'Enabled' : 'Disabled'} ${toToggle.length} MCP server(s)`
        : `MCP server "${target}" ${isEnabling ? 'enabled' : 'disabled'}`,
    );
  }, [action, target, mcpClients, toggleMcpServer, onComplete]);

  return null;
}

function MCPOAuthLogin({
  target,
  onComplete,
}: {
  target: string;
  onComplete: (result: string) => void;
}): React.ReactNode {
  const server = useAppState(s => s.mcp.clients.find(c => c.name === target));
  const reconnectMcpServer = useMcpReconnect();
  const didRun = useRef(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    const controller = new AbortController();

    async function login(): Promise<void> {
      if (!server) {
        onComplete(`MCP server "${target}" not found`);
        return;
      }
      if (server.config.type !== 'http' && server.config.type !== 'sse') {
        onComplete(`MCP server "${target}" does not support OAuth`);
        return;
      }

      await revokeServerTokens(target, server.config, {
        preserveStepUpState: true,
      });
      await performMCPOAuthFlow(
        target,
        server.config,
        setAuthorizationUrl,
        controller.signal,
      );
      clearMcpAuthCache();
      const result = await reconnectMcpServer(target);
      onComplete(
        result.client.type === 'connected'
          ? `Authenticated and connected to MCP server "${target}"`
          : `Authentication completed, but MCP server "${target}" returned ${result.client.type}`,
      );
    }

    void login().catch(error => {
      if (error instanceof AuthenticationCancelledError) {
        onComplete(`Authentication cancelled for MCP server "${target}"`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      onComplete(`Could not authenticate MCP server "${target}": ${message}`);
    });
    return () => controller.abort();
  }, [onComplete, reconnectMcpServer, server, target]);

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box>
        <Spinner />
        <Text> Authenticating with MCP server {target}</Text>
      </Box>
      {authorizationUrl && (
        <Box flexDirection="column">
          <Text dimColor>If the browser does not open, use this URL:</Text>
          <Link url={authorizationUrl} />
        </Box>
      )}
    </Box>
  );
}

/** Clears OAuth credentials for one user-configured remote MCP server. */
function MCPOAuthLogout({
  target,
  onComplete,
}: {
  target: string;
  onComplete: (result: string) => void;
}): null {
  const server = useAppState(s => s.mcp.clients.find(c => c.name === target));
  const disconnectMcpServerForLogout = useMcpLogoutDisconnect();
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    async function logout(): Promise<void> {
      if (!server) {
        onComplete(`MCP server "${target}" not found`);
        return;
      }

      if (server.config.type !== 'http' && server.config.type !== 'sse') {
        onComplete(`MCP server "${target}" does not use OAuth credentials`);
        return;
      }

      // This only affects MCP OAuth storage, not application Provider credentials.
      await revokeServerTokens(target, server.config);
      clearMcpAuthCache();
      await disconnectMcpServerForLogout(target);
      onComplete(`Cleared OAuth credentials for MCP server "${target}"`);
    }

    void logout().catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      onComplete(`Could not clear OAuth credentials for "${target}": ${message}`);
    });
  }, [disconnectMcpServerForLogout, onComplete, server, target]);

  return null;
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  if (args) {
    const parts = args.trim().split(/\s+/);

    // Allow /mcp no-redirect to bypass the redirect for testing
    if (parts[0] === 'no-redirect') {
      return <MCPSettings onComplete={onDone} />;
    }

    if (parts[0] === 'reconnect' && parts[1]) {
      return <MCPReconnect serverName={parts.slice(1).join(' ')} onComplete={onDone} />;
    }

    if (parts[0] === 'login' && parts[1]) {
      return <MCPOAuthLogin target={parts.slice(1).join(' ')} onComplete={onDone} />;
    }

    if (parts[0] === 'logout' && parts[1]) {
      return <MCPOAuthLogout target={parts.slice(1).join(' ')} onComplete={onDone} />;
    }

    if (parts[0] === 'enable' || parts[0] === 'disable') {
      return (
        <MCPToggle action={parts[0]} target={parts.length > 1 ? parts.slice(1).join(' ') : 'all'} onComplete={onDone} />
      );
    }
  }

  // Redirect base /mcp command to /plugins installed tab for ant users
  if (process.env.USER_TYPE === 'ant') {
    return <PluginSettings onComplete={onDone} args="manage" showMcpRedirectMessage />;
  }

  return <MCPSettings onComplete={onDone} />;
}
