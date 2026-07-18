// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import figures from 'figures';
import { useSearchInput } from '../../../hooks/useSearchInput.js';
import type { JumpHandle } from '../../../components/VirtualMessageList.js';
import { Box, Text, useTerminalFocus, useTerminalTitle } from '@anthropic/ink';
import * as React from 'react';
import { useEffect, useState, type RefObject } from 'react';
import { useShortcutDisplay } from '../../../keybindings/useShortcutDisplay.js';
// Dead code elimination: conditional imports
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
// Ant-only org warning. Conditional require so the org UUID list is
// eliminated from external builds (one UUID is on excluded-strings).
const useAntOrgWarningNotification: typeof import('../../../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification =
  process.env.USER_TYPE === 'ant'
    ? require('../../../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification
    : () => {};
// Dead code elimination: conditional import for coordinator mode
const getCoordinatorUserContext: (
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
) => { [k: string]: string } = feature('COORDINATOR_MODE')
  ? require('../../../coordinator/coordinatorMode.js').getCoordinatorUserContext
  : () => ({});
import type { MCPServerConnection } from '../../../services/mcp/types.js';
// Dead code elimination: conditional import for loop mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../../../proactive/index.js') : null;
const PROACTIVE_NO_OP_SUBSCRIBE = (_cb: () => void) => () => {};
const PROACTIVE_FALSE = () => false;
const PROACTIVE_NULL = (): number | null => null;
const SUGGEST_BG_PR_NOOP = (_p: string, _n: string): boolean => false;
const useProactive =
  feature('PROACTIVE') || feature('KAIROS') ? require('../../../proactive/useProactive.js').useProactive : null;
const useScheduledTasks = feature('AGENT_TRIGGERS')
  ? require('../../../hooks/useScheduledTasks.js').useScheduledTasks
  : null;
const useGoalContinuation: typeof import('../../../hooks/useGoalContinuation.js').useGoalContinuation | null = feature(
  'GOAL',
)
  ? require('../../../hooks/useGoalContinuation.js').useGoalContinuation
  : null;
const useMasterMonitor = feature('UDS_INBOX')
  ? require('../../../hooks/useMasterMonitor.js').useMasterMonitor
  : () => undefined;
const useSlaveNotifications = feature('UDS_INBOX')
  ? require('../../../hooks/useSlaveNotifications.js').useSlaveNotifications
  : () => undefined;
const usePipeIpc = feature('UDS_INBOX') ? require('../../../hooks/usePipeIpc.js').usePipeIpc : () => undefined;
const usePipeRelay = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeRelay.js').usePipeRelay
  : () => ({ relayPipeMessage: () => false, pipeReturnHadErrorRef: { current: false } });
const usePipePermissionForward = feature('UDS_INBOX')
  ? require('../../../hooks/usePipePermissionForward.js').usePipePermissionForward
  : () => undefined;
const usePipeMuteSync = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeMuteSync.js').usePipeMuteSync
  : () => undefined;
const usePipeRouter = feature('UDS_INBOX')
  ? require('../../../hooks/usePipeRouter.js').usePipeRouter
  : () => ({ routeToSelectedPipes: () => false });
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const AntModelSwitchCallout =
  process.env.USER_TYPE === 'ant'
    ? require('../../../components/AntModelSwitchCallout.js').AntModelSwitchCallout
    : null;
const shouldShowAntModelSwitch =
  process.env.USER_TYPE === 'ant'
    ? require('../../../components/AntModelSwitchCallout.js').shouldShowModelSwitchCallout
    : (): boolean => false;
const UndercoverAutoCallout =
  process.env.USER_TYPE === 'ant'
    ? require('../../../components/UndercoverAutoCallout.js').UndercoverAutoCallout
    : null;
import type { ScrollBoxHandle } from '@anthropic/ink';

// Stable empty array for hooks that accept MCPServerConnection[] — avoids
// creating a new [] literal on every render in remote mode, which would
// cause useEffect dependency changes and infinite re-render loops.
const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

// Stable stub for useAssistantHistory's non-KAIROS branch — avoids a new
// function identity each render, which would break composedOnScroll's memo.
const HISTORY_STUB = { maybeLoadOlder: (_: ScrollBoxHandle) => {} };
// Window after a user-initiated scroll during which type-into-empty does NOT
// repin to bottom. Josh Rosen's workflow: Claude emits long output → scroll
// up to read the start → start typing → before this fix, snapped to bottom.
// https://anthropic.slack.com/archives/C07VBSHV7EV/p1773545449871739
const RECENT_SCROLL_REPIN_WINDOW_MS = 3000;

// Use LRU cache to prevent unbounded memory growth
// 100 files should be sufficient for most coding sessions while preventing
// memory issues when working across many files in large projects

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

/**
 * Small component to display transcript mode footer with dynamic keybinding.
 * Must be rendered inside KeybindingSetup to access keybinding context.
 */
export function TranscriptModeFooter({
  showAllInTranscript,
  virtualScroll,
  searchBadge,
  suppressShowAll = false,
  status,
}: {
  showAllInTranscript: boolean;
  virtualScroll: boolean;
  /** Minimap while navigating a closed-bar search. Shows n/N hints +
   *  right-aligned count instead of scroll hints. */
  searchBadge?: { current: number; count: number };
  /** Hide the ctrl+e hint. The [ dump path shares this footer with
   *  env-opted dump (CLAUDE_CODE_NO_FLICKER=0 / DISABLE_VIRTUAL_SCROLL=1),
   *  but ctrl+e only works in the env case — useGlobalKeybindings.tsx
   *  gates on !virtualScrollActive which is env-derived, doesn't know
   *  [ happened. */
  suppressShowAll?: boolean;
  /** Transient status (v-for-editor progress). Notifications render inside
   *  PromptInput which isn't mounted in transcript — addNotification queues
   *  but nothing draws it. */
  status?: string;
}): React.ReactNode {
  const toggleShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const showAllShortcut = useShortcutDisplay('transcript:toggleShowAll', 'Transcript', 'ctrl+e');
  return (
    <Box
      noSelect
      alignItems="center"
      alignSelf="center"
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
    >
      <Text dimColor>
        Showing detailed transcript · {toggleShortcut} to toggle
        {searchBadge
          ? ' · n/N to navigate'
          : virtualScroll
            ? ` · ${figures.arrowUp}${figures.arrowDown} scroll · home/end top/bottom`
            : suppressShowAll
              ? ''
              : ` · ${showAllShortcut} to ${showAllInTranscript ? 'collapse' : 'show all'}`}
      </Text>
      {status ? (
        // v-for-editor render progress — transient, preempts the search
        // badge since the user just pressed v and wants to see what's
        // happening. Clears after 4s.
        <>
          <Box flexGrow={1} />
          <Text>{status} </Text>
        </>
      ) : searchBadge ? (
        // Engine-counted — close enough for a rough location hint. May
        // drift from render-count for ghost/phantom messages.
        <>
          <Box flexGrow={1} />
          <Text dimColor>
            {searchBadge.current}/{searchBadge.count}
            {'  '}
          </Text>
        </>
      ) : null}
    </Box>
  );
}

/** less-style / bar. 1-row, same border-top styling as TranscriptModeFooter
 *  so swapping them in the bottom slot doesn't shift ScrollBox height.
 *  useSearchInput handles readline editing; we report query changes and
 *  render the counter. Incremental — re-search + highlight per keystroke. */
export function TranscriptSearchBar({
  jumpRef,
  count,
  current,
  onClose,
  onCancel,
  setHighlight,
  initialQuery,
}: {
  jumpRef: RefObject<JumpHandle | null>;
  count: number;
  current: number;
  /** Enter — commit. Query persists for n/N. */
  onClose: (lastQuery: string) => void;
  /** Esc/ctrl+c/ctrl+g — undo to pre-/ state. */
  onCancel: () => void;
  setHighlight: (query: string) => void;
  // Seed with the previous query (less: / shows last pattern). Mount-fire
  // of the effect re-scans with the same query — idempotent (same matches,
  // nearest-ptr, same highlights). User can edit or clear.
  initialQuery: string;
}): React.ReactNode {
  const { query, cursorOffset } = useSearchInput({
    isActive: true,
    initialQuery,
    onExit: () => onClose(query),
    onCancel,
  });
  // Index warm-up runs before the query effect so it measures the real
  // cost — otherwise setSearchQuery fills the cache first and warm
  // reports ~0ms while the user felt the actual lag.
  // First / in a transcript session pays the extractSearchText cost.
  // Subsequent / return 0 immediately (indexWarmed ref in VML).
  // Transcript is frozen at ctrl+o so the cache stays valid.
  // Initial 'building' so warmDone is false on mount — the [query] effect
  // waits for the warm effect's first resolve instead of racing it. With
  // null initial, warmDone would be true on mount → [query] fires →
  // setSearchQuery fills cache → warm reports ~0ms while the user felt
  // the real lag.
  const [indexStatus, setIndexStatus] = React.useState<'building' | { ms: number } | null>('building');
  React.useEffect(() => {
    let alive = true;
    let hideTimeout: ReturnType<typeof setTimeout> | undefined;
    const warm = jumpRef.current?.warmSearchIndex;
    if (!warm) {
      setIndexStatus(null); // VML not mounted yet — rare, skip indicator
      return;
    }
    setIndexStatus('building');
    warm().then(ms => {
      if (!alive) return;
      // <20ms = imperceptible. No point showing "indexed in 3ms".
      if (ms < 20) {
        setIndexStatus(null);
      } else {
        setIndexStatus({ ms });
        hideTimeout = setTimeout(() => alive && setIndexStatus(null), 2000);
      }
    });
    return () => {
      alive = false;
      if (hideTimeout) clearTimeout(hideTimeout);
    };
  }, [jumpRef]); // mount-only per stable search bar ref
  // Gate the query effect on warm completion. setHighlight stays instant
  // (screen-space overlay, no indexing). setSearchQuery (the scan) waits.
  const warmDone = indexStatus !== 'building';
  useEffect(() => {
    if (!warmDone) return;
    jumpRef.current?.setSearchQuery(query);
    setHighlight(query);
  }, [jumpRef, query, setHighlight, warmDone]);
  const off = cursorOffset;
  const cursorChar = off < query.length ? query[off] : ' ';
  return (
    <Box
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
      // applySearchHighlight scans the whole screen buffer. The query
      // text rendered here IS on screen — /foo matches its own 'foo' in
      // the bar. With no content matches that's the ONLY visible match →
      // gets CURRENT → underlined. noSelect makes searchHighlight.ts:76
      // skip these cells (same exclusion as gutters). You can't text-
      // select the bar either; it's transient chrome, fine.
      noSelect
    >
      <Text>/</Text>
      <Text>{query.slice(0, off)}</Text>
      <Text inverse>{cursorChar}</Text>
      {off < query.length && <Text>{query.slice(off + 1)}</Text>}
      <Box flexGrow={1} />
      {indexStatus === 'building' ? (
        <Text dimColor>indexing… </Text>
      ) : indexStatus ? (
        <Text dimColor>indexed in {indexStatus.ms}ms </Text>
      ) : count === 0 && query ? (
        <Text color="error">no matches </Text>
      ) : count > 0 ? (
        // Engine-counted (indexOf on extractSearchText). May drift from
        // render-count for ghost/phantom messages — badge is a rough
        // location hint. scanElement gives exact per-message positions
        // but counting ALL would cost ~1-3ms × matched-messages.
        <Text dimColor>
          {current}/{count}
          {'  '}
        </Text>
      ) : null}
    </Box>
  );
}

const TITLE_ANIMATION_FRAMES = ['⠂', '⠐'];
const TITLE_STATIC_PREFIX = '✳';
const TITLE_ANIMATION_INTERVAL_MS = 960;

/**
 * Sets the terminal tab title, with an animated prefix glyph while a query
 * is running. Isolated from REPL so the 960ms animation tick re-renders only
 * this leaf component (which returns null — pure side-effect) instead of the
 * entire REPL tree. Before extraction, the tick was ~1 REPL render/sec for
 * the duration of every turn, dragging PromptInput and friends along.
 */
export function AnimatedTerminalTitle({
  isAnimating,
  title,
  disabled,
  noPrefix,
}: {
  isAnimating: boolean;
  title: string;
  disabled: boolean;
  noPrefix: boolean;
}): null {
  const terminalFocused = useTerminalFocus();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (disabled || noPrefix || !isAnimating || !terminalFocused) return;
    const interval = setInterval(
      setFrame => setFrame(f => (f + 1) % TITLE_ANIMATION_FRAMES.length),
      TITLE_ANIMATION_INTERVAL_MS,
      setFrame,
    );
    return () => clearInterval(interval);
  }, [disabled, noPrefix, isAnimating, terminalFocused]);
  const prefix = isAnimating ? (TITLE_ANIMATION_FRAMES[frame] ?? TITLE_STATIC_PREFIX) : TITLE_STATIC_PREFIX;
  useTerminalTitle(disabled ? null : noPrefix ? title : `${prefix} ${title}`);
  return null;
}
