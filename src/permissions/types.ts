export type PermissionEffect = "allow" | "deny" | "approval_required";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "consumed";

export interface ActionRequest {
  readonly actorId: string;
  readonly tool: string;
  readonly action: string;
  readonly target: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface PermissionRuleInput {
  readonly actorId: string;
  readonly tool: string;
  readonly action: string;
  readonly targetPattern?: string;
  readonly effect: PermissionEffect;
}

export interface PermissionRule extends Required<PermissionRuleInput> {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PolicyDecision {
  readonly effect: PermissionEffect;
  readonly reason: string;
  readonly ruleId: string | null;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly actorId: string;
  readonly tool: string;
  readonly action: string;
  readonly target: string;
  readonly actionHash: string;
  readonly status: ApprovalStatus;
  readonly requestedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly consumedAt: string | null;
}
