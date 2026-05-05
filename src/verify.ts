import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { VerifyCriterion, VerifyResult } from "./types.js";

export function runVerify(criterion: VerifyCriterion): VerifyResult {
  switch (criterion.kind) {
    case "file_exists":
      return verifyFileExists(criterion.path!);
    case "file_contains":
      return verifyFileContains(criterion.path!, criterion.pattern!);
    case "command":
      return verifyCommand(criterion.run!);
    case "attested":
      // Attested verification is trust-based — always passes when the caller
      // explicitly completes the node. The caller is expected to have checked.
      return { passed: true };
  }
}

function verifyFileExists(path: string): VerifyResult {
  if (existsSync(path)) {
    return { passed: true };
  }
  return { passed: false, reason: `File does not exist: ${path}` };
}

function verifyFileContains(path: string, pattern: string): VerifyResult {
  if (!existsSync(path)) {
    return { passed: false, reason: `File does not exist: ${path}` };
  }
  const content = readFileSync(path, "utf-8");
  if (content.includes(pattern)) {
    return { passed: true };
  }
  return { passed: false, reason: `File "${path}" does not contain pattern: "${pattern}"` };
}

function verifyCommand(command: string): VerifyResult {
  try {
    execSync(command, { stdio: "pipe", timeout: 30_000 });
    return { passed: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, reason: `Command failed: ${message}` };
  }
}
