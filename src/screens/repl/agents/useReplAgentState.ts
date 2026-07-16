import { useEffect } from 'react'
import { useAppState, useSetAppState } from '../../../state/AppState.js'
import { isLocalAgentTask } from '../../../tasks/LocalAgentTask/LocalAgentTask.js'
import { isInProcessTeammateTask } from '../../../tasks/InProcessTeammateTask/types.js'
import { asAgentId } from '../../../types/ids.js'
import { getAgentTranscript } from '../../../utils/sessionStorage.js'

export function useReplAgentState() {
  const agentDefinitions = useAppState(state => state.agentDefinitions)
  const spinnerTip = useAppState(state => state.spinnerTip)
  const showExpandedTodos = useAppState(state => state.expandedView) === 'tasks'
  const pendingWorkerRequest = useAppState(state => state.pendingWorkerRequest)
  const pendingSandboxRequest = useAppState(
    state => state.pendingSandboxRequest,
  )
  const teamContext = useAppState(state => state.teamContext)
  const tasks = useAppState(state => state.tasks)
  const workerSandboxPermissions = useAppState(
    state => state.workerSandboxPermissions,
  )
  const elicitation = useAppState(state => state.elicitation)
  const ultraplanPendingChoice = useAppState(
    state => state.ultraplanPendingChoice,
  )
  const ultraplanLaunchPending = useAppState(
    state => state.ultraplanLaunchPending,
  )
  const viewingAgentTaskId = useAppState(state => state.viewingAgentTaskId)
  const setAppState = useSetAppState()

  const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined
  const needsBootstrap =
    isLocalAgentTask(viewedTask) && viewedTask.retain && !viewedTask.diskLoaded
  useEffect(() => {
    if (!viewingAgentTaskId || !needsBootstrap) return
    const taskId = viewingAgentTaskId
    void getAgentTranscript(asAgentId(taskId)).then(result => {
      setAppState(previous => {
        const task = previous.tasks[taskId]
        if (!isLocalAgentTask(task) || task.diskLoaded || !task.retain)
          return previous
        const live = task.messages ?? []
        const liveUuids = new Set(live.map(message => message.uuid))
        const diskOnly = result
          ? result.messages.filter(message => !liveUuids.has(message.uuid))
          : []
        return {
          ...previous,
          tasks: {
            ...previous.tasks,
            [taskId]: {
              ...task,
              messages: [...diskOnly, ...live],
              diskLoaded: true,
            },
          },
        }
      })
    })
  }, [needsBootstrap, setAppState, viewingAgentTaskId])

  const viewedTeammateTask =
    viewedTask && isInProcessTeammateTask(viewedTask) ? viewedTask : undefined
  const viewedAgentTask =
    viewedTeammateTask ??
    (viewedTask && isLocalAgentTask(viewedTask) ? viewedTask : undefined)

  return {
    agentDefinitions,
    spinnerTip,
    showExpandedTodos,
    pendingWorkerRequest,
    pendingSandboxRequest,
    teamContext,
    tasks,
    workerSandboxPermissions,
    elicitation,
    ultraplanPendingChoice,
    ultraplanLaunchPending,
    viewingAgentTaskId,
    viewedTask,
    viewedTeammateTask,
    viewedAgentTask,
    setAppState,
  }
}
