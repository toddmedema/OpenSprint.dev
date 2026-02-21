import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import projectReducer from "./slices/projectSlice";
import websocketReducer from "./slices/websocketSlice";
import sketchReducer from "./slices/sketchSlice";
import planReducer from "./slices/planSlice";
import executeReducer from "./slices/executeSlice";
import taskRegistryReducer from "./slices/taskRegistrySlice";
import evalReducer from "./slices/evalSlice";
import deliverReducer from "./slices/deliverSlice";
import notificationReducer from "./slices/notificationSlice";
import { websocketMiddleware } from "./middleware/websocketMiddleware";
import { agentOutputFilterMiddleware } from "./middleware/agentOutputFilterMiddleware";
import { notificationListener } from "./listeners/notificationListener";

export const store = configureStore({
  reducer: {
    project: projectReducer,
    websocket: websocketReducer,
    sketch: sketchReducer,
    plan: planReducer,
    execute: executeReducer,
    taskRegistry: taskRegistryReducer,
    eval: evalReducer,
    deliver: deliverReducer,
    notification: notificationReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ["ws/connect", "ws/disconnect", "ws/send"],
      },
    })
      .concat(websocketMiddleware, agentOutputFilterMiddleware)
      .prepend(notificationListener.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
