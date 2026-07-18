// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle'
import { join } from 'path'
import { tmpdir } from 'os'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- / n N Esc [ v are bare letters in transcript modal context, same class as g/G/j/k in ScrollKeybindingHandler
import { useInput } from '@anthropic/ink'
import { useTerminalSize } from '../../../hooks/useTerminalSize.js'
import { useSearchHighlight } from '@anthropic/ink'
import type { JumpHandle } from '../../../components/VirtualMessageList.js'
import { renderMessagesToPlainText } from '../../../utils/exportRenderer.js'
import { openFileInExternalEditor } from '../../../utils/editor.js'
import { writeFile } from 'fs/promises'
import * as React from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { type Command } from '../../../commands.js'
import type { DirectConnectConfig } from '../../../server/directConnectManager.js'
import type { SSHSession } from '../../../ssh/createSSHSession.js'
// Dead code elimination: conditional imports
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
// Ant-only org warning. Conditional require so the org UUID list is
// eliminated from external builds (one UUID is on excluded-strings).
const useAntOrgWarningNotification: typeof import('../../../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification =
  process.env.USER_TYPE === 'ant'
    ? require('../../../hooks/notifs/useAntOrgWarningNotification.js')
        .useAntOrgWarningNotification
    : () => {}
// Dead code elimination: conditional import for coordinator mode
const getCoordinatorUserContext: (
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
) => { [k: string]: string } = feature('COORDINATOR_MODE')
  ? require('../../../coordinator/coordinatorMode.js').getCoordinatorUserContext
  : () => ({})
import type { Tool } from '../../../Tool.js'
import { type StreamingToolUse } from '../../../utils/messages.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import type {
  Message as MessageType,
  HookResultMessage,
} from '../../../types/message.js'
import type { MCPServerConnection } from '../../../services/mcp/types.js'
import type { ScopedMcpServerConfig } from '../../../services/mcp/types.js'
import type { AgentDefinition } from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { type ContentReplacementRecord } from '../../../utils/toolResultStorage.js'
import type { AgentColorName } from '@claude-code-best/builtin-tools/tools/AgentTool/agentColorManager.js'
import { type FileHistorySnapshot } from '../../../utils/fileHistory.js'
// Dead code elimination: conditional import for loop mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../../proactive/index.js')
    : null
const PROACTIVE_NO_OP_SUBSCRIBE = (_cb: () => void) => () => {}
const PROACTIVE_FALSE = () => false
const PROACTIVE_NULL = (): number | null => null
const SUGGEST_BG_PR_NOOP = (_p: string, _n: string): boolean => false
const useProactive =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../../proactive/useProactive.js').useProactive
    : null
const useScheduledTasks = feature('AGENT_TRIGGERS')
  ? require('../../../hooks/useScheduledTasks.js').useScheduledTasks
  : null
const useGoalContinuation:
  | typeof import('../../../hooks/useGoalContinuation.js').useGoalContinuation
  | null = feature('GOAL')
  ? require('../../../hooks/useGoalContinuation.js').useGoalContinuation
  : null
const useMasterMonitor = feature('UDS_INBOX')
  ? require('../../../hooks/useMasterMonitor.js').useMasterMonitor
  : () => undefined
const useSlaveNotifications = feature('UDS_INBOX')
  ? require('../../../hooks/useSlaveNotifications.js').useSlaveNotifications
  : () => undefined
const usePipeIpc = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeIpc.js').usePipeIpc
  : () => undefined
const usePipeRelay = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeRelay.js').usePipeRelay
  : () => ({
      relayPipeMessage: () => false,
      pipeReturnHadErrorRef: { current: false },
    })
const usePipePermissionForward = feature('UDS_INBOX')
  ? require('../../../hooks/usePipePermissionForward.js')
      .usePipePermissionForward
  : () => undefined
const usePipeMuteSync = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeMuteSync.js').usePipeMuteSync
  : () => undefined
const usePipeRouter = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeRouter.js').usePipeRouter
  : () => ({ routeToSelectedPipes: () => false })
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const AntModelSwitchCallout =
  process.env.USER_TYPE === 'ant'
    ? require('../../../components/AntModelSwitchCallout.js')
        .AntModelSwitchCallout
    : null
const shouldShowAntModelSwitch =
  process.env.USER_TYPE === 'ant'
    ? require('../../../components/AntModelSwitchCallout.js')
        .shouldShowModelSwitchCallout
    : (): boolean => false
const UndercoverAutoCallout =
  process.env.USER_TYPE === 'ant'
    ? require('../../../components/UndercoverAutoCallout.js')
        .UndercoverAutoCallout
    : null
// Session manager removed - using AppState now
import { isFullscreenEnvEnabled } from '../../../utils/fullscreen.js'

// Stable empty array for hooks that accept MCPServerConnection[] — avoids
// creating a new [] literal on every render in remote mode, which would
// cause useEffect dependency changes and infinite re-render loops.
const EMPTY_MCP_CLIENTS: MCPServerConnection[] = []

// Window after a user-initiated scroll during which type-into-empty does NOT
// repin to bottom. Josh Rosen's workflow: Claude emits long output → scroll
// up to read the start → start typing → before this fix, snapped to bottom.
// https://anthropic.slack.com/archives/C07VBSHV7EV/p1773545449871739
const RECENT_SCROLL_REPIN_WINDOW_MS = 3000

// Use LRU cache to prevent unbounded memory growth
// 100 files should be sufficient for most coding sessions while preventing
// memory issues when working across many files in large projects

export type Props = {
  commands: Command[]
  debug: boolean
  initialTools: Tool[]
  // Initial messages to populate the REPL with
  initialMessages?: MessageType[]
  // Deferred hook messages promise — REPL renders immediately and injects
  // hook messages when they resolve. Awaited before the first API call.
  pendingHookMessages?: Promise<HookResultMessage[]>
  initialFileHistorySnapshots?: FileHistorySnapshot[]
  // Content-replacement records from a resumed session's transcript — used to
  // reconstruct contentReplacementState so the same results are re-replaced
  initialContentReplacements?: ContentReplacementRecord[]
  // Initial agent context for session resume (name/color set via /rename or /color)
  initialAgentName?: string
  initialAgentColor?: AgentColorName
  mcpClients?: MCPServerConnection[]
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
  autoConnectIdeFlag?: boolean
  strictMcpConfig?: boolean
  systemPrompt?: string
  appendSystemPrompt?: string
  // Optional callback invoked before query execution
  // Called after user message is added to conversation but before API call
  // Return false to prevent query execution
  onBeforeQuery?: (
    input: string,
    newMessages: MessageType[],
  ) => Promise<boolean>
  // Optional callback when a turn completes (model finishes responding)
  onTurnComplete?: (messages: MessageType[]) => void | Promise<void>
  // When true, disables REPL input (hides prompt and prevents message selector)
  disabled?: boolean
  // Optional agent definition to use for the main thread
  mainThreadAgentDefinition?: AgentDefinition
  // When true, disables all slash commands
  disableSlashCommands?: boolean
  // Task list id: when set, enables tasks mode that watches a task list and auto-processes tasks.
  taskListId?: string
  // Remote session config for --remote mode (uses CCR as execution engine)
  // Direct connect config for `claude connect` mode (connects to a claude server)
  directConnectConfig?: DirectConnectConfig
  // SSH session for `claude ssh` mode (local REPL, remote tools over ssh)
  sshSession?: SSHSession
  // Thinking configuration to use when thinking is enabled
  thinkingConfig: ThinkingConfig
}

export type Screen = 'prompt' | 'transcript'

export interface TranscriptControlsOptions {
  screen: 'prompt' | 'transcript'
  setScreen: React.Dispatch<React.SetStateAction<'prompt' | 'transcript'>>
  messages: MessageType[]
  deferredMessages: MessageType[]
  streamingToolUses: StreamingToolUse[]
  tools: readonly Tool[]
  disableVirtualScroll: boolean
}

export function useTranscriptControls({
  screen,
  setScreen,
  messages,
  deferredMessages,
  streamingToolUses,
  tools,
  disableVirtualScroll,
}: TranscriptControlsOptions) {
  const [showAllInTranscript, setShowAllInTranscript] = useState(false)
  const [dumpMode, setDumpMode] = useState(false)
  const [editorStatus, setEditorStatus] = useState('')
  const editorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const editorGenRef = useRef(0)
  const editorRenderingRef = useRef(false)
  const [frozenTranscriptState, setFrozenTranscriptState] = useState<{
    messagesLength: number
    streamingToolUsesLength: number
  } | null>(null)
  // Callback to capture frozen state when entering transcript mode
  const handleEnterTranscript = useCallback(() => {
    setFrozenTranscriptState({
      messagesLength: messages.length,
      streamingToolUsesLength: streamingToolUses.length,
    })
  }, [messages.length, streamingToolUses.length])

  // Callback to clear frozen state when exiting transcript mode
  const handleExitTranscript = useCallback(() => {
    setFrozenTranscriptState(null)
  }, [])

  // Props for GlobalKeybindingHandlers component (rendered inside KeybindingSetup)
  const virtualScrollActive = isFullscreenEnvEnabled() && !disableVirtualScroll

  // Transcript search state. Hooks must be unconditional so they live here
  // (not inside the `if (screen === 'transcript')` branch below); isActive
  // gates the useInput. Query persists across bar open/close so n/N keep
  // working after Enter dismisses the bar (less semantics).
  const jumpRef = useRef<JumpHandle | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCount, setSearchCount] = useState(0)
  const [searchCurrent, setSearchCurrent] = useState(0)
  const onSearchMatchesChange = useCallback(
    (count: number, current: number) => {
      setSearchCount(count)
      setSearchCurrent(current)
    },
    [],
  )

  useInput(
    (input, key, event) => {
      if (key.ctrl || key.meta) return
      // No Esc handling here — less has no navigating mode. Search state
      // (highlights, n/N) is just state. Esc/q/ctrl+c → transcript:exit
      // (ungated). Highlights clear on exit via the screen-change effect.
      if (input === '/') {
        // Capture scrollTop NOW — typing is a preview, 0-matches snaps
        // back here. Synchronous ref write, fires before the bar's
        // mount-effect calls setSearchQuery.
        jumpRef.current?.setAnchor()
        setSearchOpen(true)
        event.stopImmediatePropagation()
        return
      }
      // Held-key batching: tokenizer coalesces to 'nnn'. Same uniform-batch
      // pattern as modalPagerAction in ScrollKeybindingHandler.tsx. Each
      // repeat is a step (n isn't idempotent like g).
      const c = input[0]
      if (
        (c === 'n' || c === 'N') &&
        input === c.repeat(input.length) &&
        searchCount > 0
      ) {
        const fn =
          c === 'n' ? jumpRef.current?.nextMatch : jumpRef.current?.prevMatch
        if (fn) for (let i = 0; i < input.length; i++) fn()
        event.stopImmediatePropagation()
      }
    },
    // Search needs virtual scroll (jumpRef drives VirtualMessageList). [
    // kills it, so !dumpMode — after [ there's nothing to jump in.
    {
      isActive:
        screen === 'transcript' &&
        virtualScrollActive &&
        !searchOpen &&
        !dumpMode,
    },
  )
  const {
    setQuery: setHighlight,
    scanElement,
    setPositions,
  } = useSearchHighlight()

  // Resize → abort search. Positions are (msg, query, WIDTH)-keyed —
  // cached positions are stale after a width change (new layout, new
  // wrapping). Clearing searchQuery triggers VML's setSearchQuery('')
  // which clears positionsCache + setPositions(null). Bar closes.
  // User hits / again → fresh everything.
  const transcriptCols = useTerminalSize().columns
  const prevColsRef = React.useRef(transcriptCols)
  React.useEffect(() => {
    if (prevColsRef.current !== transcriptCols) {
      prevColsRef.current = transcriptCols
      if (searchQuery || searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
        setSearchCount(0)
        setSearchCurrent(0)
        jumpRef.current?.disarmSearch()
        setHighlight('')
      }
    }
  }, [transcriptCols, searchQuery, searchOpen, setHighlight])

  // Transcript escape hatches. Bare letters in modal context (no prompt
  // competing for input) — same class as g/G/j/k in ScrollKeybindingHandler.
  useInput(
    (input, key, event) => {
      if (key.ctrl || key.meta) return
      if (input === 'q') {
        // less: q quits the pager. ctrl+o toggles; q is the lineage exit.
        handleExitTranscript()
        event.stopImmediatePropagation()
        return
      }
      if (input === '[' && !dumpMode) {
        // Force dump-to-scrollback. Also expand + uncap — no point dumping
        // a subset. Terminal/tmux cmd-F can now find anything. Guard here
        // (not in isActive) so v still works post-[ — dump-mode footer at
        // ~4898 wires editorStatus, confirming v is meant to stay live.
        setDumpMode(true)
        setShowAllInTranscript(true)
        event.stopImmediatePropagation()
      } else if (input === 'v') {
        // less-style: v opens the file in $VISUAL/$EDITOR. Render the full
        // transcript (same path /export uses), write to tmp, hand off.
        // openFileInExternalEditor handles alt-screen suspend/resume for
        // terminal editors; GUI editors spawn detached.
        event.stopImmediatePropagation()
        // Drop double-taps: the render is async and a second press before it
        // completes would run a second parallel render (double memory, two
        // tempfiles, two editor spawns). editorGenRef only guards
        // transcript-exit staleness, not same-session concurrency.
        if (editorRenderingRef.current) return
        editorRenderingRef.current = true
        // Capture generation + make a staleness-aware setter. Each write
        // checks gen (transcript exit bumps it → late writes from the
        // async render go silent).
        const gen = editorGenRef.current
        const setStatus = (s: string): void => {
          if (gen !== editorGenRef.current) return
          clearTimeout(editorTimerRef.current)
          setEditorStatus(s)
        }
        setStatus(`rendering ${deferredMessages.length} messages…`)
        void (async () => {
          try {
            // Width = terminal minus vim's line-number gutter (4 digits +
            // space + slack). Floor at 80. PassThrough has no .columns so
            // without this Ink defaults to 80. Trailing-space strip: right-
            // aligned timestamps still leave a flexbox spacer run at EOL.
            // eslint-disable-next-line custom-rules/prefer-use-terminal-size -- one-shot at keypress time, not a reactive render dep
            const w = Math.max(80, (process.stdout.columns ?? 80) - 6)
            const raw = await renderMessagesToPlainText(
              deferredMessages,
              tools,
              w,
            )
            const text = raw.replace(/[ \t]+$/gm, '')
            const path = join(tmpdir(), `cc-transcript-${Date.now()}.txt`)
            await writeFile(path, text)
            const opened = openFileInExternalEditor(path)
            setStatus(
              opened
                ? `opening ${path}`
                : `wrote ${path} · no $VISUAL/$EDITOR set`,
            )
          } catch (e) {
            setStatus(
              `render failed: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
          editorRenderingRef.current = false
          if (gen !== editorGenRef.current) return
          editorTimerRef.current = setTimeout(s => s(''), 4000, setEditorStatus)
        })()
      }
    },
    // !searchOpen: typing 'v' or '[' in the search bar is search input, not
    // a command. No !dumpMode here — v should work after [ (the [ handler
    // guards itself inline).
    { isActive: screen === 'transcript' && virtualScrollActive && !searchOpen },
  )

  // Fresh `less` per transcript entry. Prevents stale highlights matching
  // unrelated normal-mode text (overlay is alt-screen-global) and avoids
  // surprise n/N on re-entry. Same exit resets [ dump mode — each ctrl+o
  // entry is a fresh instance.
  const inTranscript = screen === 'transcript' && virtualScrollActive
  useEffect(() => {
    if (!inTranscript) {
      setSearchQuery('')
      setSearchCount(0)
      setSearchCurrent(0)
      setSearchOpen(false)
      editorGenRef.current++
      clearTimeout(editorTimerRef.current)
      setDumpMode(false)
      setEditorStatus('')
    }
  }, [inTranscript])
  useEffect(() => {
    setHighlight(inTranscript ? searchQuery : '')
    // Clear the position-based CURRENT (yellow) overlay too. setHighlight
    // only clears the scan-based inverse. Without this, the yellow box
    // persists at its last screen coords after ctrl-c exits transcript.
    if (!inTranscript) setPositions(null)
  }, [inTranscript, searchQuery, setHighlight, setPositions])

  const globalKeybindingProps = {
    screen,
    setScreen,
    showAllInTranscript,
    setShowAllInTranscript,
    messageCount: messages.length,
    onEnterTranscript: handleEnterTranscript,
    onExitTranscript: handleExitTranscript,
    virtualScrollActive,
    // Bar-open is a mode (owns keystrokes — j/k type, Esc cancels).
    // Navigating (query set, bar closed) is NOT — Esc exits transcript,
    // same as less q with highlights still visible. useSearchInput
    // doesn't stopPropagation, so without this gate transcript:exit
    // would fire on the same Esc that cancels the bar (child registers
    // first, fires first, bubbles).
    searchBarOpen: searchOpen,
  }

  // Use frozen lengths to slice arrays, avoiding memory overhead of cloning
  const transcriptMessages = frozenTranscriptState
    ? deferredMessages.slice(0, frozenTranscriptState.messagesLength)
    : deferredMessages
  const transcriptStreamingToolUses = frozenTranscriptState
    ? streamingToolUses.slice(0, frozenTranscriptState.streamingToolUsesLength)
    : streamingToolUses

  return {
    showAllInTranscript,
    setShowAllInTranscript,
    dumpMode,
    editorStatus,
    handleEnterTranscript,
    handleExitTranscript,
    virtualScrollActive,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchCount,
    setSearchCount,
    searchCurrent,
    setSearchCurrent,
    onSearchMatchesChange,
    jumpRef,
    scanElement,
    setHighlight,
    setPositions,
    transcriptCols,
    globalKeybindingProps,
    transcriptMessages,
    transcriptStreamingToolUses,
  }
}
