export type NodeStatus = "pending" | "in_progress" | "done" | "failed" | "blocked";

export interface VerifyCriterion {
  kind: "file_exists" | "file_contains" | "command" | "attested";
  path?: string;
  pattern?: string;
  run?: string;
}

export interface PlanNode {
  id: string;
  task: string;
  deps: string[];
  verify: VerifyCriterion;
  type?: string;
  max_retries?: number;
}

export interface PlanFile {
  plan_id: string;
  version: number;
  max_retries?: number;
  nodes: PlanNode[];
}

export interface NodeState {
  id: string;
  task: string;
  deps: string[];
  verify: VerifyCriterion;
  type?: string;
  status: NodeStatus;
  output: NodeOutput | null;
  max_retries: number;
  attempts: number;
  last_error: string | null;
}

export interface NodeOutput {
  summary: string;
  artifacts?: string[];
  metadata?: Record<string, unknown>;
}

export interface DagState {
  plan_id: string;
  version: number;
  plan_hash: string;
  nodes: Record<string, NodeState>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface VerifyResult {
  passed: boolean;
  reason?: string;
}

export interface TransitionResult {
  success: boolean;
  error?: string;
  next_ready?: string[];
}

export interface NodeContext {
  id: string;
  task: string;
  verify: VerifyCriterion;
  deps: string[];
  upstream_outputs: Record<string, NodeOutput | null>;
  attempts: number;
  max_retries: number;
  last_error: string | null;
}
