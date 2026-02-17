import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { FeedbackItem } from "@opensprint/shared";
import { api } from "../../api/client";

export interface VerifyState {
  feedback: FeedbackItem[];
  loading: boolean;
  submitting: boolean;
  error: string | null;
}

const initialState: VerifyState = {
  feedback: [],
  loading: false,
  submitting: false,
  error: null,
};

export const fetchFeedback = createAsyncThunk("verify/fetchFeedback", async (projectId: string) => {
  return api.feedback.list(projectId);
});

export const submitFeedback = createAsyncThunk(
  "verify/submitFeedback",
  async ({
    projectId,
    text,
    images,
  }: {
    projectId: string;
    text: string;
    images?: string[];
  }) => {
    return api.feedback.submit(projectId, text, images);
  },
);

export const recategorizeFeedback = createAsyncThunk(
  "verify/recategorizeFeedback",
  async ({ projectId, feedbackId }: { projectId: string; feedbackId: string }) => {
    return api.feedback.recategorize(projectId, feedbackId);
  },
);

const verifySlice = createSlice({
  name: "verify",
  initialState,
  reducers: {
    setFeedback(state, action: PayloadAction<FeedbackItem[]>) {
      state.feedback = action.payload;
    },
    setVerifyError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    resetVerify() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchFeedback
      .addCase(fetchFeedback.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchFeedback.fulfilled, (state, action) => {
        state.feedback = action.payload;
        state.loading = false;
      })
      .addCase(fetchFeedback.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load feedback";
      })
      // submitFeedback
      .addCase(submitFeedback.pending, (state) => {
        state.submitting = true;
        state.error = null;
      })
      .addCase(submitFeedback.fulfilled, (state, action) => {
        state.submitting = false;
        state.feedback.unshift(action.payload);
      })
      .addCase(submitFeedback.rejected, (state, action) => {
        state.submitting = false;
        state.error = action.error.message ?? "Failed to submit feedback";
      })
      // recategorizeFeedback
      .addCase(recategorizeFeedback.fulfilled, (state, action) => {
        const idx = state.feedback.findIndex((f) => f.id === action.payload.id);
        if (idx !== -1) state.feedback[idx] = action.payload;
      })
      .addCase(recategorizeFeedback.rejected, (state, action) => {
        state.error = action.error.message ?? "Failed to recategorize feedback";
      });
  },
});

export const { setFeedback, setVerifyError, resetVerify } = verifySlice.actions;
export default verifySlice.reducer;
