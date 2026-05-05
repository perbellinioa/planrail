import type { DagState, NodeContext, NodeOutput } from "./types.js";

export function getNodeContext(dag: DagState, nodeId: string): NodeContext | { error: string } {
  const node = dag.nodes[nodeId];
  if (!node) {
    return { error: `Node "${nodeId}" does not exist` };
  }

  const upstream_outputs: Record<string, NodeOutput | null> = {};
  for (const dep of node.deps) {
    const depNode = dag.nodes[dep];
    if (depNode) {
      upstream_outputs[dep] = depNode.output;
    }
  }

  return {
    id: node.id,
    task: node.task,
    verify: node.verify,
    deps: node.deps,
    upstream_outputs,
    attempts: node.attempts,
    max_retries: node.max_retries,
    last_error: node.last_error,
  };
}
