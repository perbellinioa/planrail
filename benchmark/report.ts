import type { BaselineResult } from "./baseline.js";
import type { DagResult } from "./dag-runner.js";
import type { VerifyResult } from "./verify-checks.js";

export interface BenchmarkReport {
  model: string;
  timestamp: string;
  baseline: {
    result: BaselineResult;
    verification: VerifyResult[];
  };
  dag: {
    result: DagResult;
    verification: VerifyResult[];
  };
  comparison: {
    baseline_adherence: string;
    dag_adherence: string;
    baseline_output_tokens: number;
    dag_output_tokens: number;
    token_diff: string;
    token_savings_pct: string;
    baseline_files: number;
    dag_files: number;
  };
}

export function buildReport(
  model: string,
  baselineResult: BaselineResult,
  baselineVerify: VerifyResult[],
  dagResult: DagResult,
  dagVerify: VerifyResult[],
): BenchmarkReport {
  const bPassed = baselineVerify.filter((v) => v.passed).length;
  const dPassed = dagVerify.filter((v) => v.passed).length;
  const total = baselineVerify.length;

  const bTokens = baselineResult.tokens.total;
  const dTokens = dagResult.tokens.total;
  const bOutput = baselineResult.tokens.output;
  const dOutput = dagResult.tokens.output;
  const savings = bTokens > 0 ? ((bTokens - dTokens) / bTokens) * 100 : 0;

  return {
    model,
    timestamp: new Date().toISOString(),
    baseline: { result: baselineResult, verification: baselineVerify },
    dag: { result: dagResult, verification: dagVerify },
    comparison: {
      baseline_adherence: `${bPassed}/${total} (${Math.round((bPassed / total) * 100)}%)`,
      dag_adherence: `${dPassed}/${total} (${Math.round((dPassed / total) * 100)}%)`,
      baseline_output_tokens: bOutput,
      dag_output_tokens: dOutput,
      token_diff: `${bTokens} vs ${dTokens}`,
      token_savings_pct: `${savings > 0 ? "+" : ""}${savings.toFixed(1)}%`,
      baseline_files: baselineResult.files_generated.length,
      dag_files: dagResult.files_generated.length,
    },
  };
}

export function formatReport(report: BenchmarkReport): string {
  const c = report.comparison;
  const b = report.baseline;
  const d = report.dag;

  let out = `
## planrail Benchmark Results

**Model:** ${report.model}
**Date:** ${report.timestamp}
**Plan:** ${b.result.plan_id} (${b.verification.length} nodes)

### Summary

| Metric              | Baseline (no DAG) | With planrail     |
|---------------------|-------------------|-------------------|
| Plan adherence      | ${c.baseline_adherence.padEnd(17)} | ${c.dag_adherence.padEnd(17)} |
| Output tokens       | ${String(c.baseline_output_tokens).padEnd(17)} | ${String(c.dag_output_tokens).padEnd(17)} |
| LLM calls           | ${String(b.result.llm_calls).padEnd(17)} | ${String(d.result.llm_calls).padEnd(17)} |
| Files generated     | ${String(c.baseline_files).padEnd(17)} | ${String(c.dag_files).padEnd(17)} |
| Duration            | ${(b.result.duration_ms / 1000).toFixed(1)}s${" ".repeat(14 - (b.result.duration_ms / 1000).toFixed(1).length)} | ${(d.result.duration_ms / 1000).toFixed(1)}s${" ".repeat(14 - (d.result.duration_ms / 1000).toFixed(1).length)} |

> **Note:** Output tokens measure actual generated content. Input tokens are not
> compared because multi-call DAG execution includes per-call system prompt overhead
> that single-call baseline does not.

### Verification Details

#### Baseline
${b.verification.map((v) => `- [${v.passed ? "✓" : "✗"}] ${v.node_id}${v.reason ? ": " + v.reason : ""}`).join("\n")}

#### With planrail
${d.verification.map((v) => `- [${v.passed ? "✓" : "✗"}] ${v.node_id}${v.reason ? ": " + v.reason : ""}`).join("\n")}
`;

  return out.trim();
}
