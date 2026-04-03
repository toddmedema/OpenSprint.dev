import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CommandIntent } from "@opensprint/shared";
import { api } from "../client.js";

export const commandKeys = {
  all: ["commands"] as const,
  history: (projectId: string, params?: Record<string, string>) =>
    [...commandKeys.all, "history", projectId, params] as const,
  run: (projectId: string, runId: string) =>
    [...commandKeys.all, "run", projectId, runId] as const,
};

export function useCommandHistory(
  projectId: string | undefined,
  params?: Record<string, string>
) {
  return useQuery({
    queryKey: commandKeys.history(projectId ?? "", params),
    queryFn: () => api.commands.history(projectId!, params),
    enabled: !!projectId,
  });
}

export function useCommandRun(projectId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: commandKeys.run(projectId ?? "", runId ?? ""),
    queryFn: () => api.commands.getRun(projectId!, runId!),
    enabled: !!projectId && !!runId,
  });
}

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
