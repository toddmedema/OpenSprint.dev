import type { Middleware, ThunkDispatch, UnknownAction } from "@reduxjs/toolkit";
import { createAction } from "@reduxjs/toolkit";
import type {
  ServerEvent,
  ClientEvent,
  ExecuteStatusEvent,
  FeedbackMappedEvent,
  FeedbackResolvedEvent,
} from "@opensprint/shared";
import {
  setConnected,
  setHilRequest,
  setHilNotification,
  setDeliverToast,
} from "../slices/websocketSlice";
import { fetchPrd, fetchPrdHistory, fetchSketchChat } from "../slices/sketchSlice";
import { fetchPlanStatus } from "../slices/planSlice";
import { fetchPlans, fetchSinglePlan } from "../slices/planSlice";
import {
  fetchTasks,
  appendAgentOutput,
  setOrchestratorRunning,
  setAwaitingApproval,
  setActiveTasks,
  setCompletionState,
  taskUpdated,
} from "../slices/executeSlice";
import { mergeTaskUpdate } from "../slices/taskRegistrySlice";
import { fetchFeedback, updateFeedbackItem } from "../slices/evalSlice";
import {
  appendDeliverOutput,
  deliverStarted,
  deliverCompleted,
  fetchDeliverStatus,
  fetchDeliverHistory,
} from "../slices/deliverSlice";

type StoreDispatch = ThunkDispatch<unknown, unknown, UnknownAction>;

export const wsConnect = createAction<{ projectId: string }>("ws/connect");
export const wsConnectHome = createAction("ws/connectHome");
export const wsDisconnect = createAction("ws/disconnect");
export const wsSend = createAction<ClientEvent>("ws/send");

/** Sentinel for "connected to /ws with no project" (so backend sees a client and does not open a duplicate tab on homepage) */
const HOME_SENTINEL = "__home__";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export const websocketMiddleware: Middleware = (storeApi) => {
  const dispatch = storeApi.dispatch as StoreDispatch;
  let ws: WebSocket | null = null;
  let currentProjectId: string | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;

  function cleanup() {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    currentProjectId = null;
    reconnectAttempt = 0;
  }

  function connect(projectId: string) {
    // Skip if already connected to the same project
    if (currentProjectId === projectId && ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    cleanup();
    intentionalClose = false;
    currentProjectId = projectId;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/projects/${projectId}`;

    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      reconnectAttempt = 0;
      dispatch(setConnected(true));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;
        handleServerEvent(dispatch, projectId, data);
      } catch {
        // ignore parse errors
      }
    };

    socket.onclose = () => {
      // Ignore if this is a stale socket (replaced by a newer connection)
      if (socket !== ws) return;
      dispatch(setConnected(false));
      if (!intentionalClose && currentProjectId) {
        scheduleReconnect(projectId);
      }
    };

    socket.onerror = () => {
      // onclose will fire after onerror
    };
  }

  function scheduleReconnect(projectId: string) {
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      if (currentProjectId === projectId) {
        connect(projectId);
      }
    }, delay);
  }

  function connectHome() {
    if (currentProjectId === HOME_SENTINEL && ws?.readyState === WebSocket.OPEN) return;
    cleanup();
    intentionalClose = false;
    currentProjectId = HOME_SENTINEL;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      reconnectAttempt = 0;
      dispatch(setConnected(true));
    };
    socket.onmessage = () => {
      // No project scope — backend does not send project events to /ws-only clients
    };
    socket.onclose = () => {
      if (socket !== ws) return;
      dispatch(setConnected(false));
      if (!intentionalClose && currentProjectId === HOME_SENTINEL) {
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
          RECONNECT_MAX_MS
        );
        reconnectAttempt++;
        reconnectTimer = setTimeout(() => {
          if (currentProjectId === HOME_SENTINEL) connectHome();
        }, delay);
      }
    };
    socket.onerror = () => {};
  }

  // Reconnect immediately when tab becomes visible (helps after server restart; avoids throttled timers in background)
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || intentionalClose) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (currentProjectId === HOME_SENTINEL) connectHome();
        else if (currentProjectId) connect(currentProjectId);
      }
    });
  }

  function handleServerEvent(d: StoreDispatch, projectId: string, event: ServerEvent) {
    switch (event.type) {
      case "hil.request":
        if (event.blocking) {
          d(setHilRequest(event));
          d(setHilNotification(null));
          d(setAwaitingApproval(true));
        } else {
          d(setHilNotification(event));
          d(setHilRequest(null));
        }
        break;

      case "prd.updated":
        d(fetchPrd(projectId));
        d(fetchPrdHistory(projectId));
        d(fetchSketchChat(projectId));
        d(fetchPlanStatus(projectId));
        break;

      case "plan.updated":
        d(fetchPlans({ projectId, background: true }));
        d(fetchSinglePlan({ projectId, planId: event.planId }));
        break;

      case "task.updated":
        d(
          taskUpdated({
            taskId: event.taskId,
            status: event.status,
            assignee: event.assignee,
            priority: event.priority,
          })
        );
        d(
          mergeTaskUpdate({
            projectId,
            taskId: event.taskId,
            status: event.status,
            assignee: event.assignee,
            priority: event.priority,
          })
        );
        break;

      case "agent.started":
        d(fetchTasks(projectId));
        break;

      case "agent.completed":
        d(fetchTasks(projectId));
        d(
          setCompletionState({
            taskId: event.taskId,
            status: event.status,
            testResults: event.testResults,
          })
        );
        break;

      case "agent.output":
        d(appendAgentOutput({ taskId: event.taskId, chunk: event.chunk }));
        break;

      case "execute.status": {
        const statusEv = event as ExecuteStatusEvent;
        const activeTasks = statusEv.activeTasks ?? [];
        const running = activeTasks.length > 0 || statusEv.queueDepth > 0;
        d(setOrchestratorRunning(running));
        if (statusEv.awaitingApproval !== undefined) {
          d(setAwaitingApproval(Boolean(statusEv.awaitingApproval)));
        }
        d(setActiveTasks(activeTasks));
        break;
      }

      case "feedback.mapped":
      case "feedback.resolved": {
        const ev = event as FeedbackMappedEvent | FeedbackResolvedEvent;
        if (ev.item) {
          d(updateFeedbackItem(ev.item));
        } else {
          d(fetchFeedback(projectId));
        }
        break;
      }

      case "deliver.started":
        d(deliverStarted({ deployId: event.deployId }));
        d(setDeliverToast({ message: "Delivery started", variant: "started" }));
        break;

      case "deliver.output":
        d(appendDeliverOutput({ deployId: event.deployId, chunk: event.chunk }));
        break;

      case "deliver.completed":
        d(
          deliverCompleted({
            deployId: event.deployId,
            success: event.success,
            fixEpicId: event.fixEpicId,
          })
        );
        d(
          setDeliverToast({
            message: event.success ? "Delivery succeeded" : "Delivery failed",
            variant: event.success ? "succeeded" : "failed",
          })
        );
        d(fetchDeliverStatus(projectId));
        d(fetchDeliverHistory(projectId));
        break;
    }
  }

  return (next) => (action) => {
    if (wsConnect.match(action)) {
      connect(action.payload.projectId);
    } else if (wsConnectHome.match(action)) {
      connectHome();
    } else if (wsDisconnect.match(action)) {
      cleanup();
    } else if (wsSend.match(action)) {
      if (
        ws?.readyState === WebSocket.OPEN &&
        currentProjectId &&
        currentProjectId !== HOME_SENTINEL
      ) {
        ws.send(JSON.stringify(action.payload));
      }
    }

    return next(action);
  };
};
