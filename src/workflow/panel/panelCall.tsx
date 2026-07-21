import type { LocalJSXCommandCall } from '../../types/command.js';
import { LocalErrorBoundary } from '../../components/LocalErrorBoundary.js';
import { WorkflowsPanel } from './WorkflowsPanel.js';

/**
 * local-jsx call for /workflows: builds the panel element and returns it for Ink to render.
 *
 * Wrapped in LocalErrorBoundary: when useSyncExternalStore / listNamed / child components
 * throw, the exception must not break through to the REPL top level and crash the whole session; the boundary falls back to a local error card.
 * onDone/context are injected by the command runtime; args is unused (the panel has no parameterized behavior).
 */
export const call: LocalJSXCommandCall = async (onDone, context, _args) => (
  <LocalErrorBoundary name="WorkflowsPanel">
    <WorkflowsPanel onDone={onDone} context={context} />
  </LocalErrorBoundary>
);
