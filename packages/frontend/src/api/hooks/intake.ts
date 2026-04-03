import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../client.js";

export const intakeKeys = {
  all: ["intake"] as const,
  list: (projectId: string, params?: Record<string, string>) =>
    [...intakeKeys.all, "list", projectId, params] as const,
  detail: (projectId: string, itemId: string) =>
    [...intakeKeys.all, "detail", projectId, itemId] as const,
};

export function useIntakeItems(
  projectId: string | undefined,
  params?: Record<string, string>,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: intakeKeys.list(projectId ?? "", params),
    queryFn: () => api.intake.list(projectId!, params),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useIntakeItem(projectId: string | undefined, itemId: string | undefined) {
  return useQuery({
    queryKey: intakeKeys.detail(projectId ?? "", itemId ?? ""),
    queryFn: () => api.intake.get(projectId!, itemId!),
    enabled: !!projectId && !!itemId,
  });
}

export function useConvertIntakeItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, action, linkTaskId }: { itemId: string; action: string; linkTaskId?: string }) =>
      api.intake.convert(projectId, itemId, { action, linkTaskId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: intakeKeys.list(projectId) });
    },
  });
}

export function useIgnoreIntakeItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.intake.ignore(projectId, itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: intakeKeys.list(projectId) });
    },
  });
}

export function useBulkIntakeAction(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { itemIds: string[]; action: string; dryRun?: boolean }) =>
      api.intake.bulk(projectId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: intakeKeys.list(projectId) });
    },
  });
}
