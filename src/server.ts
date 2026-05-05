import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getReadyNodes, startNode, completeNode, failNode, getStatus, isDagComplete } from "./dag.js";
import { runVerify } from "./verify.js";
import { getNodeContext } from "./context.js";
import {
  safeParsePlan,
  initDagFromPlan,
  computePlanHash,
  saveDagState,
  loadDagState,
} from "./state.js";
import type { DagState, NodeOutput } from "./types.js";

let dag: DagState | null = null;
let stateDir = ".dag";

export function setStateDir(dir: string): void {
  stateDir = dir;
}

function requireDag(): DagState {
  if (!dag) {
    throw new Error("No plan loaded. Call dag_load_plan first.");
  }
  return dag;
}

function persist(): void {
  if (dag) {
    saveDagState(dag, stateDir);
  }
}

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "planrail",
    version: "0.1.0",
  });

  // --- Validation tools ---

  server.registerTool(
    "dag_load_plan",
    {
      description: "Load a YAML plan file into the DAG. Validates structure before accepting. Rejects if a different plan is already in progress.",
      inputSchema: { yaml_path: z.string().describe("Path to the YAML plan file") },
    },
    async ({ yaml_path }) => {
      const parsed = safeParsePlan(yaml_path);
      if (!parsed.ok) {
        return textResult({ loaded: false, error: parsed.error });
      }

      const { plan, validation } = parsed;

      // Check for mid-run reload with changed topology
      const existing = loadDagState(stateDir);
      if (existing) {
        const newHash = computePlanHash(plan);
        if (existing.plan_hash === newHash) {
          dag = existing;
          return textResult({ loaded: true, restored: true, plan_id: dag.plan_id, nodes: Object.keys(dag.nodes).length, warnings: validation.warnings, status: getStatus(dag) });
        }
        const hasProgress = Object.values(existing.nodes).some((n) => n.status !== "pending");
        if (hasProgress) {
          return textResult({ loaded: false, error: "A different plan is already in progress. Reset state first.", existing_plan: existing.plan_id });
        }
      }

      dag = initDagFromPlan(plan);
      persist();
      return textResult({ loaded: true, plan_id: dag.plan_id, nodes: Object.keys(dag.nodes).length, warnings: validation.warnings, ready: getReadyNodes(dag) });
    },
  );

  server.registerTool(
    "dag_validate_plan",
    {
      description: "Validate a YAML plan file without loading it. Returns structural errors and warnings.",
      inputSchema: { yaml_path: z.string().describe("Path to the YAML plan file") },
    },
    async ({ yaml_path }) => {
      const parsed = safeParsePlan(yaml_path);
      if (!parsed.ok) {
        return textResult({ valid: false, errors: [parsed.error], warnings: [] });
      }
      return textResult(parsed.validation);
    },
  );

  // --- Execution tools ---

  server.registerTool(
    "dag_get_ready_nodes",
    {
      description: "List all nodes whose dependencies are satisfied and can be started. Returns multiple nodes if parallel execution is possible.",
      inputSchema: {},
    },
    async () => {
      const d = requireDag();
      const ready = getReadyNodes(d);
      return textResult({ ready, is_complete: isDagComplete(d) });
    },
  );

  server.registerTool(
    "dag_get_node_context",
    {
      description: "Get the full context for a node: task description, verify criterion, upstream outputs, attempt count, and last error.",
      inputSchema: { node_id: z.string().describe("The ID of the node") },
    },
    async ({ node_id }) => {
      const d = requireDag();
      const context = getNodeContext(d, node_id);
      return textResult(context);
    },
  );

  server.registerTool(
    "dag_start_node",
    {
      description: "Mark a node as in_progress. Guards: dependencies must be done, node must be pending, retries not exhausted.",
      inputSchema: { node_id: z.string().describe("The ID of the node to start") },
    },
    async ({ node_id }) => {
      const d = requireDag();
      const result = startNode(d, node_id);
      if (result.success) persist();
      return textResult(result);
    },
  );

  server.registerTool(
    "dag_complete_node",
    {
      description: "Mark a node as done. Runs the verify criterion (file_exists, file_contains, command). For 'attested' verify, the caller must confirm the output is correct. Stores the node output for downstream consumers.",
      inputSchema: {
        node_id: z.string().describe("The ID of the node to complete"),
        summary: z.string().describe("Brief summary of what was produced"),
        artifacts: z.array(z.string()).optional().describe("File paths of produced artifacts"),
        metadata: z.record(z.unknown()).optional().describe("Optional metadata"),
      },
    },
    async ({ node_id, summary, artifacts, metadata }) => {
      const d = requireDag();
      const node = d.nodes[node_id];
      if (!node) {
        return textResult({ success: false, error: `Node "${node_id}" does not exist` });
      }
      if (node.status !== "in_progress") {
        return textResult({ success: false, error: `Node "${node_id}" is not running (status: ${node.status})` });
      }

      // Run verification
      const verifyResult = runVerify(node.verify);
      if (!verifyResult.passed) {
        return textResult({
          success: false,
          error: "Verification failed",
          verify_reason: verifyResult.reason,
          suggestion: "Fix the issue and call dag_complete_node again",
        });
      }

      const output: NodeOutput = { summary, artifacts, metadata };
      const result = completeNode(d, node_id, output);
      if (result.success) persist();
      return textResult({ ...result, is_complete: isDagComplete(d) });
    },
  );

  server.registerTool(
    "dag_fail_node",
    {
      description: "Mark a node as failed. Increments retry counter. If retries exhausted, marks downstream nodes as blocked.",
      inputSchema: {
        node_id: z.string().describe("The ID of the failed node"),
        reason: z.string().describe("Why the node failed"),
      },
    },
    async ({ node_id, reason }) => {
      const d = requireDag();
      const result = failNode(d, node_id, reason);
      persist();
      return textResult(result);
    },
  );

  server.registerTool(
    "dag_get_status",
    {
      description: "Get the full DAG state: all nodes with their status, attempts, errors, and whether the DAG is complete.",
      inputSchema: {},
    },
    async () => {
      const d = requireDag();
      return textResult({
        plan_id: d.plan_id,
        version: d.version,
        plan_hash: d.plan_hash,
        is_complete: isDagComplete(d),
        nodes: getStatus(d),
      });
    },
  );

  return server;
}
