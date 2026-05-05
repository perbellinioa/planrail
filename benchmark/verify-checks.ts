import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanFile } from "../src/types.js";

export interface VerifyResult {
  node_id: string;
  passed: boolean;
  reason?: string;
}

export function verifyAll(plan: PlanFile, workDir: string): VerifyResult[] {
  const results: VerifyResult[] = [];

  for (const node of plan.nodes) {
    const v = node.verify;
    let passed = false;
    let reason = "";

    switch (v.kind) {
      case "file_exists": {
        const fullPath = join(workDir, v.path!);
        passed = existsSync(fullPath);
        if (!passed) reason = `File not found: ${v.path}`;
        break;
      }
      case "file_contains": {
        const fullPath = join(workDir, v.path!);
        if (!existsSync(fullPath)) {
          reason = `File not found: ${v.path}`;
        } else {
          const content = readFileSync(fullPath, "utf-8");
          passed = content.includes(v.pattern!);
          if (!passed) reason = `File "${v.path}" missing pattern: "${v.pattern}"`;
        }
        break;
      }
      case "command": {
        // Skip command verification in benchmark (no real project setup)
        passed = false;
        reason = "Command verification skipped in benchmark";
        break;
      }
      case "attested": {
        passed = true;
        break;
      }
    }

    results.push({ node_id: node.id, passed, reason: passed ? undefined : reason });
  }

  return results;
}
