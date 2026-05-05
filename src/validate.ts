import type { PlanFile, ValidationResult } from "./types.js";

export function validatePlan(plan: PlanFile): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set<string>();

  // Duplicate ID detection
  for (const node of plan.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node ID: "${node.id}"`);
    }
    nodeIds.add(node.id);
  }

  for (const node of plan.nodes) {
    // Empty ID or task
    if (!node.id || node.id.trim() === "") {
      errors.push("Node has empty ID");
    }
    if (!node.task || node.task.trim() === "") {
      errors.push(`Node "${node.id}" has empty task description`);
    }

    // Missing verify criterion
    if (!node.verify) {
      errors.push(`Node "${node.id}" has no verify criterion`);
    } else if (!["file_exists", "file_contains", "command", "attested"].includes(node.verify.kind)) {
      errors.push(`Node "${node.id}" has invalid verify kind: "${node.verify.kind}"`);
    } else {
      // Validate verify fields per kind
      if (node.verify.kind === "file_exists" && !node.verify.path) {
        errors.push(`Node "${node.id}" verify (file_exists) missing "path"`);
      }
      if (node.verify.kind === "file_contains") {
        if (!node.verify.path) errors.push(`Node "${node.id}" verify (file_contains) missing "path"`);
        if (!node.verify.pattern) errors.push(`Node "${node.id}" verify (file_contains) missing "pattern"`);
      }
      if (node.verify.kind === "command" && !node.verify.run) {
        errors.push(`Node "${node.id}" verify (command) missing "run"`);
      }
    }

    // Missing or invalid deps
    if (!node.deps || !Array.isArray(node.deps)) {
      errors.push(`Node "${node.id}" has missing or invalid deps field`);
      continue;
    }

    // Self-dependency
    if (node.deps.includes(node.id)) {
      errors.push(`Node "${node.id}" depends on itself`);
    }

    // Missing dependency references
    for (const dep of node.deps) {
      if (!nodeIds.has(dep)) {
        errors.push(`Node "${node.id}" depends on "${dep}" which does not exist`);
      }
    }
  }

  // Cycle detection (DFS)
  if (errors.length === 0) {
    const cycleError = detectCycle(plan);
    if (cycleError) {
      errors.push(cycleError);
    }
  }

  // Contract node warnings
  const consumerCount = new Map<string, number>();
  for (const node of plan.nodes) {
    for (const dep of node.deps ?? []) {
      consumerCount.set(dep, (consumerCount.get(dep) || 0) + 1);
    }
  }
  for (const node of plan.nodes) {
    const consumers = consumerCount.get(node.id) || 0;
    if (consumers >= 2 && node.type !== "contract") {
      warnings.push(
        `Node "${node.id}" has ${consumers} downstream consumers but is not marked as type "contract". Consider adding an explicit contract node.`,
      );
    }
  }

  // Leaf node warnings
  for (const node of plan.nodes) {
    const consumers = consumerCount.get(node.id) || 0;
    if (consumers === 0 && node.type !== "verify" && node.type !== "test") {
      warnings.push(
        `Node "${node.id}" is a leaf node but not marked as type "verify" or "test"`,
      );
    }
  }

  // Plan metadata
  if (!plan.plan_id || plan.plan_id.trim() === "") {
    errors.push("Plan is missing plan_id");
  }
  if (plan.version === undefined || plan.version === null) {
    errors.push("Plan is missing version");
  }
  if (plan.max_retries !== undefined && (!Number.isInteger(plan.max_retries) || plan.max_retries < 1)) {
    errors.push("Plan max_retries must be a positive integer");
  }

  for (const node of plan.nodes) {
    if (node.max_retries !== undefined && (!Number.isInteger(node.max_retries) || node.max_retries < 1)) {
      errors.push(`Node "${node.id}" max_retries must be a positive integer`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function detectCycle(plan: PlanFile): string | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const node of plan.nodes) {
    color.set(node.id, WHITE);
  }

  const depsMap = new Map<string, string[]>();
  for (const node of plan.nodes) {
    depsMap.set(node.id, node.deps ?? []);
  }

  function dfs(nodeId: string, path: string[]): string | null {
    color.set(nodeId, GRAY);
    path.push(nodeId);

    for (const dep of depsMap.get(nodeId) || []) {
      if (color.get(dep) === GRAY) {
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart).concat(dep);
        return `Cycle detected: ${cycle.join(" → ")}`;
      }
      if (color.get(dep) === WHITE) {
        const result = dfs(dep, path);
        if (result) return result;
      }
    }

    path.pop();
    color.set(nodeId, BLACK);
    return null;
  }

  for (const node of plan.nodes) {
    if (color.get(node.id) === WHITE) {
      const result = dfs(node.id, []);
      if (result) return result;
    }
  }
  return null;
}
