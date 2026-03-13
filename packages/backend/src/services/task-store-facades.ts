import { PlanStore, type PlanInsertData } from "./plan-store.service.js";
import {
  PlanVersionStore,
  type PlanVersionInsert,
  type PlanVersionListItem,
  type PlanVersionRow,
} from "./plan-version-store.service.js";
import {
  AuditorRunStore,
  type AuditorRunInsert,
  type AuditorRunRecord,
} from "./auditor-run-store.service.js";
import {
  SelfImprovementRunHistoryStore,
  type SelfImprovementRunHistoryInsert,
  type SelfImprovementRunHistoryRecord,
} from "./self-improvement-run-history.service.js";

/** Dependencies for plan/auditor/self-improvement facade (init + write lock + stores). */
export interface TaskStorePlanAuditorSIDeps {
  ensureInitialized: () => Promise<void>;
  withWriteLock: <T>(fn: () => Promise<T>) => Promise<T>;
  planStore: PlanStore;
  planVersionStore: PlanVersionStore;
  auditorRunStore: AuditorRunStore;
  selfImprovementRunHistoryStore: SelfImprovementRunHistoryStore;
}

/**
 * Facade that delegates plan, plan-version, auditor-run, and self-improvement-run-history
 * operations to dedicated stores. Used by TaskStoreService to keep the main service focused
 * on core task CRUD while grouping plan/auditor/SI persistence in one place.
 */
export class TaskStorePlanAuditorSIFacade {
  constructor(private deps: TaskStorePlanAuditorSIDeps) {}

  async planInsert(projectId: string, planId: string, data: PlanInsertData): Promise<void> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      await this.deps.planStore.planInsert(projectId, planId, data);
    });
  }

  async planGet(
    projectId: string,
    planId: string
  ): Promise<{
    content: string;
    metadata: Record<string, unknown>;
    shipped_content: string | null;
    updated_at: string;
    current_version_number: number;
    last_executed_version_number: number | null;
  } | null> {
    await this.deps.ensureInitialized();
    return this.deps.planStore.planGet(projectId, planId);
  }

  async planGetByEpicId(
    projectId: string,
    epicId: string
  ): Promise<{
    plan_id: string;
    content: string;
    metadata: Record<string, unknown>;
    shipped_content: string | null;
    updated_at: string;
    current_version_number: number;
    last_executed_version_number: number | null;
  } | null> {
    await this.deps.ensureInitialized();
    return this.deps.planStore.planGetByEpicId(projectId, epicId);
  }

  async planListIds(projectId: string): Promise<string[]> {
    await this.deps.ensureInitialized();
    return this.deps.planStore.planListIds(projectId);
  }

  async planUpdateContent(
    projectId: string,
    planId: string,
    content: string,
    currentVersionNumber?: number
  ): Promise<void> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      await this.deps.planStore.planUpdateContent(projectId, planId, content, currentVersionNumber);
    });
  }

  async planUpdateMetadata(
    projectId: string,
    planId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      await this.deps.planStore.planUpdateMetadata(projectId, planId, metadata);
    });
  }

  async planSetShippedContent(
    projectId: string,
    planId: string,
    shippedContent: string
  ): Promise<void> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      await this.deps.planStore.planSetShippedContent(projectId, planId, shippedContent);
    });
  }

  async planGetShippedContent(projectId: string, planId: string): Promise<string | null> {
    await this.deps.ensureInitialized();
    return this.deps.planStore.planGetShippedContent(projectId, planId);
  }

  async planUpdateVersionNumbers(
    projectId: string,
    planId: string,
    updates: { current_version_number?: number; last_executed_version_number?: number | null }
  ): Promise<void> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      await this.deps.planStore.planUpdateVersionNumbers(projectId, planId, updates);
    });
  }

  async planVersionList(projectId: string, planId: string): Promise<PlanVersionListItem[]> {
    await this.deps.ensureInitialized();
    return this.deps.planVersionStore.list(projectId, planId);
  }

  async planVersionGetByVersionNumber(
    projectId: string,
    planId: string,
    versionNumber: number
  ): Promise<PlanVersionRow> {
    await this.deps.ensureInitialized();
    return this.deps.planVersionStore.getByVersionNumber(projectId, planId, versionNumber);
  }

  async planVersionInsert(data: PlanVersionInsert): Promise<PlanVersionRow> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      return this.deps.planVersionStore.insert(data);
    });
  }

  async planVersionSetExecutedVersion(
    projectId: string,
    planId: string,
    versionNumber: number
  ): Promise<void> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      await this.deps.planVersionStore.setExecutedVersion(projectId, planId, versionNumber);
    });
  }

  async planDelete(projectId: string, planId: string): Promise<boolean> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      return this.deps.planStore.planDelete(projectId, planId);
    });
  }

  async planDeleteAllForProject(projectId: string): Promise<void> {
    await this.deps.ensureInitialized();
    await this.deps.planStore.planDeleteAllForProject(projectId);
  }

  async listPlanVersions(projectId: string, planId: string): Promise<PlanVersionListItem[]> {
    await this.deps.ensureInitialized();
    return this.deps.planVersionStore.list(projectId, planId);
  }

  async getPlanVersionByNumber(
    projectId: string,
    planId: string,
    versionNumber: number
  ): Promise<PlanVersionRow> {
    await this.deps.ensureInitialized();
    return this.deps.planVersionStore.getByVersionNumber(projectId, planId, versionNumber);
  }

  async auditorRunInsert(record: AuditorRunInsert): Promise<AuditorRunRecord> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      return this.deps.auditorRunStore.insert(record);
    });
  }

  async listAuditorRunsByPlanId(projectId: string, planId: string): Promise<AuditorRunRecord[]> {
    await this.deps.ensureInitialized();
    return this.deps.auditorRunStore.listByPlanId(projectId, planId);
  }

  async insertSelfImprovementRunHistory(
    record: SelfImprovementRunHistoryInsert
  ): Promise<SelfImprovementRunHistoryRecord> {
    return this.deps.withWriteLock(async () => {
      await this.deps.ensureInitialized();
      return this.deps.selfImprovementRunHistoryStore.insert(record);
    });
  }

  async listSelfImprovementRunHistory(
    projectId: string,
    limit?: number
  ): Promise<SelfImprovementRunHistoryRecord[]> {
    await this.deps.ensureInitialized();
    return this.deps.selfImprovementRunHistoryStore.listByProjectId(projectId, limit);
  }
}
