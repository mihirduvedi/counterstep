import type {
  ActionEvent,
  AtomicWriteResult,
  ClosureReceipt,
  DemoRecord,
  InspectionRecord,
  PlanDecision,
  RecoveryPlan,
  RemediationAuthority,
  RemediationRun,
  SandboxResource,
} from "./schemas";

export type ToolExecutionName =
  | "revoke_external_access"
  | "cancel_queued_delivery";

export type AtomicWriteRequest = {
  runId: string;
  tool: ToolExecutionName;
  planId: string;
  stepId: string;
  resourceId: string;
  expectedVersion: number;
  idempotencyKey: string;
  eventId: string;
  eventSequence: number;
  timestamp: string;
  attempt: number;
  latencyMs?: number;
};

export interface CounterstepRepository {
  readonly kind: "memory" | "firestore";

  ping(): Promise<boolean>;
  resetDemo(
    demo: DemoRecord,
    resources: readonly SandboxResource[],
  ): Promise<void>;
  getDemo(demoId: string): Promise<DemoRecord | undefined>;
  listResources(demoId: string): Promise<SandboxResource[]>;
  getResource(
    demoId: string,
    resourceId: string,
  ): Promise<SandboxResource | undefined>;

  createRun(
    run: RemediationRun,
    authority: RemediationAuthority,
  ): Promise<void>;
  getRun(runId: string): Promise<RemediationRun | undefined>;
  getAuthority(runId: string): Promise<RemediationAuthority | undefined>;
  claimRunForExecution(runId: string): Promise<boolean>;
  saveRun(run: RemediationRun): Promise<void>;

  saveEventAndRun(event: ActionEvent, run: RemediationRun): Promise<void>;
  listEvents(runId: string): Promise<ActionEvent[]>;
  saveInspection(inspection: InspectionRecord): Promise<void>;
  listInspections(runId: string): Promise<InspectionRecord[]>;

  savePlanDecision(
    run: RemediationRun,
    decision: PlanDecision,
  ): Promise<void>;
  getPlanDecision(runId: string): Promise<PlanDecision | undefined>;
  getApprovedPlan(runId: string): Promise<RecoveryPlan | undefined>;
  listApprovedPlans(runId: string): Promise<RecoveryPlan[]>;

  executeAtomicWrite(request: AtomicWriteRequest): Promise<AtomicWriteResult>;

  saveClosure(run: RemediationRun, closure: ClosureReceipt): Promise<void>;
  getClosure(runId: string): Promise<ClosureReceipt | undefined>;
}
