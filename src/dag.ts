import type { DagState, NodeOutput, NodeState, TransitionResult } from "./types.js";

export function getReadyNodes(dag: DagState): string[] {
  return Object.values(dag.nodes)
    .filter(
      (n) =>
        n.status === "pending" &&
        n.deps.every((dep) => dag.nodes[dep].status === "done"),
    )
    .map((n) => n.id);
}

export function startNode(dag: DagState, nodeId: string): TransitionResult {
  const node = dag.nodes[nodeId];
  if (!node) {
    return { success: false, error: `Node "${nodeId}" does not exist` };
  }
  if (node.status === "in_progress") {
    return { success: false, error: `Node "${nodeId}" is already running` };
  }
  if (node.status === "done") {
    return { success: false, error: `Node "${nodeId}" is already done` };
  }
  if (node.status === "blocked") {
    return { success: false, error: `Node "${nodeId}" is blocked by a failed dependency` };
  }
  if (node.status === "failed" && node.attempts >= node.max_retries) {
    return { success: false, error: `Node "${nodeId}" has exhausted all ${node.max_retries} retries` };
  }

  const unmetDeps = node.deps.filter((dep) => dag.nodes[dep].status !== "done");
  if (unmetDeps.length > 0) {
    return {
      success: false,
      error: `Node "${nodeId}" has unmet dependencies: ${unmetDeps.join(", ")}`,
    };
  }

  node.status = "in_progress";
  return { success: true };
}

export function completeNode(
  dag: DagState,
  nodeId: string,
  output: NodeOutput,
): TransitionResult {
  const node = dag.nodes[nodeId];
  if (!node) {
    return { success: false, error: `Node "${nodeId}" does not exist` };
  }
  if (node.status !== "in_progress") {
    return { success: false, error: `Node "${nodeId}" is not running (status: ${node.status})` };
  }

  node.status = "done";
  node.output = output;
  return { success: true, next_ready: getReadyNodes(dag) };
}

export function failNode(
  dag: DagState,
  nodeId: string,
  reason: string,
): TransitionResult {
  const node = dag.nodes[nodeId];
  if (!node) {
    return { success: false, error: `Node "${nodeId}" does not exist` };
  }
  if (node.status !== "in_progress") {
    return { success: false, error: `Node "${nodeId}" is not running (status: ${node.status})` };
  }

  node.attempts += 1;
  node.last_error = reason;

  if (node.attempts >= node.max_retries) {
    node.status = "failed";
    propagateBlocked(dag, nodeId);
    return { success: true, error: `Node "${nodeId}" permanently failed after ${node.attempts} attempts. Downstream nodes blocked.` };
  }

  node.status = "pending";
  return { success: true, next_ready: getReadyNodes(dag) };
}

function propagateBlocked(dag: DagState, failedNodeId: string): void {
  for (const node of Object.values(dag.nodes)) {
    if (node.status === "pending" && node.deps.includes(failedNodeId)) {
      node.status = "blocked";
      propagateBlocked(dag, node.id);
    }
  }
}

export function getStatus(dag: DagState): Record<string, { status: string; attempts: number; last_error: string | null }> {
  const result: Record<string, { status: string; attempts: number; last_error: string | null }> = {};
  for (const [id, node] of Object.entries(dag.nodes)) {
    result[id] = { status: node.status, attempts: node.attempts, last_error: node.last_error };
  }
  return result;
}

export function isDagComplete(dag: DagState): boolean {
  return Object.values(dag.nodes).every(
    (n) => n.status === "done" || n.status === "failed" || n.status === "blocked",
  );
}
