import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLlmClient, parseFiles, type LlmClient } from "./llm.js";
import { initDagFromPlan } from "../src/state.js";
import { getReadyNodes, startNode, completeNode, failNode } from "../src/dag.js";
import { getNodeContext } from "../src/context.js";
import type { PlanFile, NodeOutput } from "../src/types.js";

export interface DagResult {
  plan_id: string;
  mode: "dag";
  tokens: { input: number; output: number; total: number };
  llm_calls: number;
  duration_ms: number;
  files_generated: string[];
  node_results: Record<string, { status: string; files: string[] }>;
}

export async function runDag(
  plan: PlanFile,
  workDir: string,
  llm: LlmClient,
): Promise<DagResult> {
  const start = Date.now();
  const dag = initDagFromPlan(plan);
  const allFiles: string[] = [];
  const nodeResults: Record<string, { status: string; files: string[] }> = {};

  while (true) {
    const ready = getReadyNodes(dag);
    if (ready.length === 0) break;

    // Execute ready nodes sequentially (could be parallelized)
    for (const nodeId of ready) {
      const startResult = startNode(dag, nodeId);
      if (!startResult.success) {
        nodeResults[nodeId] = { status: "start_failed", files: [] };
        continue;
      }

      const context = getNodeContext(dag, nodeId);
      if ("error" in context) {
        failNode(dag, nodeId, context.error);
        nodeResults[nodeId] = { status: "context_error", files: [] };
        continue;
      }

      // Build focused prompt with upstream context
      let upstreamSection = "";
      if (Object.keys(context.upstream_outputs).length > 0) {
        const entries = Object.entries(context.upstream_outputs)
          .filter(([, output]) => output !== null)
          .map(([depId, output]) => `### ${depId}\n${output!.summary}\nArtifacts: ${(output!.artifacts || []).join(", ")}`)
          .join("\n\n");
        upstreamSection = `\n\nCompleted upstream tasks and their outputs:\n${entries}`;
      }

      const prompt = `You are implementing one specific part of a fullstack project.

Your task: ${context.task}

Verification: The output must satisfy: ${JSON.stringify(context.verify)}${upstreamSection}

IMPORTANT: Output each file using this EXACT format — the filepath must be on the same line as the opening triple backticks:

\`\`\`prisma/schema.prisma
// file content here
\`\`\`

Use the exact file paths mentioned in the task. Only create files relevant to THIS task.`;

      const result = await llm.call(prompt);

      // Parse and write files
      const files = parseFiles(result.response);
      const nodeFiles: string[] = [];
      for (const [path, content] of files) {
        const fullPath = join(workDir, path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content);
        nodeFiles.push(path);
        allFiles.push(path);
      }

      const output: NodeOutput = {
        summary: result.response.slice(0, 500),
        artifacts: nodeFiles,
      };

      completeNode(dag, nodeId, output);
      nodeResults[nodeId] = { status: "done", files: nodeFiles };
    }
  }

  return {
    plan_id: plan.plan_id,
    mode: "dag",
    tokens: llm.totalTokens(),
    llm_calls: llm.calls().length,
    duration_ms: Date.now() - start,
    files_generated: allFiles,
    node_results: nodeResults,
  };
}
