import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLlmClient, parseFiles, type LlmClient } from "./llm.js";
import type { PlanFile } from "../src/types.js";

export interface BaselineResult {
  plan_id: string;
  mode: "baseline";
  tokens: { input: number; output: number; total: number };
  llm_calls: number;
  duration_ms: number;
  files_generated: string[];
}

export async function runBaseline(
  plan: PlanFile,
  workDir: string,
  llm: LlmClient,
): Promise<BaselineResult> {
  const start = Date.now();

  // Build a single prompt with all tasks
  const taskList = plan.nodes
    .map((n, i) => {
      const deps = n.deps.length > 0 ? ` (depends on: ${n.deps.join(", ")})` : "";
      return `${i + 1}. [${n.id}] ${n.task}${deps}`;
    })
    .join("\n");

  const prompt = `You are implementing a fullstack project. Complete ALL of the following tasks.
For each task, create the necessary files.

Tasks:
${taskList}

IMPORTANT: Output each file using this EXACT format — the filepath must be on the same line as the opening triple backticks:

\`\`\`prisma/schema.prisma
// file content here
\`\`\`

\`\`\`src/auth/index.ts
// file content here
\`\`\`

Use the exact file paths mentioned in each task. Create ALL files needed for ALL tasks.`;

  const result = await llm.call(prompt);

  // Parse and write files
  const files = parseFiles(result.response);
  const fileList: string[] = [];
  for (const [path, content] of files) {
    const fullPath = join(workDir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
    fileList.push(path);
  }

  return {
    plan_id: plan.plan_id,
    mode: "baseline",
    tokens: llm.totalTokens(),
    llm_calls: llm.calls().length,
    duration_ms: Date.now() - start,
    files_generated: fileList,
  };
}
