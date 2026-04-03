import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CommandIntent } from "@opensprint/shared";
import { api } from "../client.js";

export const commandKeys = {
  all: ["commands"] as const,
  history: (projectId: string, params?: Record<string, string>) =>
    [...commandKeys.all, "history", projectId, params] as const,
};

export function useInterpretCommand(projectId: string) {
  return useMutation({
    mutationFn: (input: string) => api.commands.interpret(projectId, input),
  });
}

export function usePreviewCommand(projectId: string) {
  return useMutation({
    mutationFn: (intent: CommandIntent) => api.commands.preview(projectId, intent),
  });
}

export function useApplyCommand(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commandRunId, idempotencyKey }: { commandRunId: string; idempotencyKey?: string }) =>
      api.commands.apply(projectId, commandRunId, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commandKeys.history(projectId) });
    },
  });
}
