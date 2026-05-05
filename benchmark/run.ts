#!/usr/bin/env npx tsx

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "./llm.js";
import { runBaseline } from "./baseline.js";
import { runDag } from "./dag-runner.js";
import { verifyAll } from "./verify-checks.js";
import { buildReport, formatReport } from "./report.js";
import { safeParsePlan } from "../src/state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = process.argv[2] || join(__dirname, "..", "examples", "fullstack-plan.yml");
const MODEL = process.argv[3] || process.env.LLM_MODEL || "claude-opus-4.7";

async function main() {
  console.log(`\n🚂 planrail benchmark`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Plan:  ${PLAN_PATH}\n`);

  // Load plan
  const parsed = safeParsePlan(PLAN_PATH);
  if (!parsed.ok) {
    console.error(`❌ Failed to load plan: ${parsed.error}`);
    process.exit(1);
  }
  const { plan } = parsed;
  console.log(`✓ Plan loaded: ${plan.plan_id} (${plan.nodes.length} nodes)\n`);

  // Prepare work directories
  const runId = Date.now().toString();
  const baselineDir = join(__dirname, "workspace", `baseline-${runId}`);
  const dagDir = join(__dirname, "workspace", `dag-${runId}`);
  mkdirSync(baselineDir, { recursive: true });
  mkdirSync(dagDir, { recursive: true });

  // Run baseline
  console.log("━".repeat(50));
  console.log("Running BASELINE (all tasks in one prompt)...");
  const baselineLlm = createLlmClient(MODEL);
  const baselineResult = await runBaseline(plan, baselineDir, baselineLlm);
  console.log(`✓ Baseline done: ${baselineResult.files_generated.length} files, ${baselineResult.tokens.total} tokens\n`);

  // Run DAG
  console.log("Running DAG (planrail-orchestrated)...");
  const dagLlm = createLlmClient(MODEL);
  const dagResult = await runDag(plan, dagDir, dagLlm);
  console.log(`✓ DAG done: ${dagResult.files_generated.length} files, ${dagResult.tokens.total} tokens\n`);

  // Verify both
  console.log("Running verification checks...");
  const baselineVerify = verifyAll(plan, baselineDir);
  const dagVerify = verifyAll(plan, dagDir);

  const bPassed = baselineVerify.filter((v) => v.passed).length;
  const dPassed = dagVerify.filter((v) => v.passed).length;
  console.log(`✓ Baseline: ${bPassed}/${baselineVerify.length} checks passed`);
  console.log(`✓ DAG:      ${dPassed}/${dagVerify.length} checks passed\n`);

  // Build report
  const report = buildReport(MODEL, baselineResult, baselineVerify, dagResult, dagVerify);
  const formatted = formatReport(report);

  console.log("━".repeat(50));
  console.log(formatted);

  // Save results
  const resultsDir = join(__dirname, "results");
  mkdirSync(resultsDir, { recursive: true });

  const resultPath = join(resultsDir, `${runId}-${MODEL.replace("/", "-")}.json`);
  writeFileSync(resultPath, JSON.stringify(report, null, 2));

  const mdPath = join(resultsDir, `${runId}-${MODEL.replace("/", "-")}.md`);
  writeFileSync(mdPath, formatted);

  console.log(`\n📊 Results saved to:`);
  console.log(`   ${resultPath}`);
  console.log(`   ${mdPath}`);

  // Cleanup workspaces
  rmSync(baselineDir, { recursive: true, force: true });
  rmSync(dagDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("❌ Benchmark failed:", err.message);
  process.exit(1);
});
