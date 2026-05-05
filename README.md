# planrail

**Minimal MCP server that enforces DAG-based plan execution for LLM agent fleets.**

Local. Private. Zero network calls. All data stays on your machine.

---

### The problem

You give an AI agent a 10-step plan. It executes 7 steps, skips 2, and contradicts itself on 1. The auth module uses sessions. The routes expect JWT. The tests import functions that don't exist.

### The fix

**planrail** ensures each agent only starts when its dependencies are done, and receives the *actual outputs* — not assumptions — from upstream steps.

Every node must prove it's done before downstream work begins. The plan topology is enforced, not suggested.

---

## Quick Start

### Install

```bash
# No install needed — use npx
npx planrail

# Or install globally
npm install -g planrail
```

### Configure your MCP client

Add to your MCP configuration (Copilot CLI, Claude Desktop, VS Code, etc.):

```json
{
  "mcpServers": {
    "planrail": {
      "command": "npx",
      "args": ["-y", "planrail"]
    }
  }
}
```

Or with a custom state directory:

```json
{
  "mcpServers": {
    "planrail": {
      "command": "npx",
      "args": ["-y", "planrail", "--state-dir", ".planrail/"]
    }
  }
}
```

### Write a plan

```yaml
# plan.yml
plan_id: my-project
version: 1
max_retries: 3

nodes:
  - id: schema
    task: "Design users table with id, email, password_hash, role"
    deps: []
    verify:
      kind: file_contains
      path: prisma/schema.prisma
      pattern: "model User"

  - id: api-contract
    task: "Define OpenAPI spec for /auth and /users"
    deps: [schema]
    type: contract
    verify:
      kind: file_exists
      path: openapi.yml

  - id: auth
    task: "Implement JWT auth"
    deps: [api-contract]
    verify:
      kind: file_exists
      path: src/auth/index.ts

  - id: tests
    task: "Write integration tests"
    deps: [auth]
    type: test
    verify:
      kind: command
      run: "npm test"
```

### Use from your LLM agent

The agent calls these tools through MCP:

```
1. dag_load_plan({ yaml_path: "plan.yml" })
   → loads plan, validates structure, returns ready nodes

2. dag_get_ready_nodes()
   → ["schema"]  (only schema has no deps)

3. dag_start_node({ node_id: "schema" })
   → marks schema as in_progress

4. dag_get_node_context({ node_id: "schema" })
   → { task, verify, upstream_outputs: {}, attempts: 0 }

5. ... agent does the work ...

6. dag_complete_node({ node_id: "schema", summary: "Created User model" })
   → runs verify (checks prisma/schema.prisma contains "model User")
   → if pass: marks done, returns next ready nodes
   → if fail: stays in_progress, returns error

7. dag_get_ready_nodes()
   → ["api-contract"]  (schema is done, so api-contract is ready)
```

---

## Tools Reference

### Validation (before execution)

| Tool | Purpose |
|------|---------|
| `dag_load_plan` | Load a YAML plan. Validates structure. Rejects if invalid or if a different plan is in progress. |
| `dag_validate_plan` | Validate a YAML plan without loading it. Returns errors + warnings. |

### Execution (during execution)

| Tool | Purpose |
|------|---------|
| `dag_get_ready_nodes` | List all nodes whose dependencies are satisfied. Returns multiple if parallel execution is possible. |
| `dag_get_node_context` | Get task, verify criterion, upstream outputs, attempt count, and last error for a node. |
| `dag_start_node` | Mark a node as in_progress. Guards: deps must be done, not already running, retries not exhausted. |
| `dag_complete_node` | Mark done + run verification + store output. If verify fails, node stays in_progress. |
| `dag_fail_node` | Mark failed + increment retry counter. If retries exhausted, blocks downstream nodes. |
| `dag_get_status` | Full DAG overview: all nodes, statuses, attempts, errors. |

---

## Plan Format

```yaml
plan_id: string       # unique identifier for this plan
version: number       # plan version
max_retries: number   # default retry limit (overridable per node)

nodes:
  - id: string        # unique node identifier
    task: string      # what the agent should do
    deps: [string]    # IDs of nodes this depends on
    type: string      # optional: "contract", "test", "verify"
    max_retries: number  # optional: override plan-level default
    verify:           # how to prove this node is done
      kind: string    # file_exists | file_contains | command | attested
      path: string    # for file_exists, file_contains
      pattern: string # for file_contains
      run: string     # for command (exit 0 = pass)
```

### Verify Criterion Types

| Kind | Server-enforced? | What it checks |
|------|-----------------|----------------|
| `file_exists` | ✅ Yes | File exists at `path` |
| `file_contains` | ✅ Yes | File at `path` contains `pattern` |
| `command` | ✅ Yes | `run` exits with code 0 |
| `attested` | ❌ Trust-based | Caller claims completion (no server check) |

### Node States

| State | Meaning |
|-------|---------|
| `pending` | Waiting for dependencies or to be started |
| `in_progress` | Agent is working on it |
| `done` | Completed and verified |
| `failed` | Failed permanently (retries exhausted) |
| `blocked` | A dependency has permanently failed |

---

## Plan Validation

`dag_load_plan` and `dag_validate_plan` run these structural checks:

- ✅ No cycles in the DAG
- ✅ All dependency references exist
- ✅ No duplicate node IDs
- ✅ No self-dependencies
- ✅ No empty IDs or task descriptions
- ✅ Every node has a valid verify criterion
- ✅ Plan has plan_id and version
- ⚠️ Nodes with 2+ consumers not marked as "contract" (warning)
- ⚠️ Leaf nodes not marked as "test" or "verify" (warning)

Semantic plan quality (is the plan *good*?) is the caller's responsibility. planrail only checks structure (is the plan *well-formed*?).

---

## Design Principles

- **The plan is a contract, not a suggestion.** The DAG enforces execution order.
- **Subgraph re-execution, not cycles.** Failed nodes retry from the orchestrator, not as back-edges.
- **Code handles invariants, LLMs handle reasoning.** State transitions are deterministic; agent work is creative.
- **60 years of industrial backing.** DAGs (PERT/CPM) are what manufacturing, aerospace, and construction converged on for dependency-driven planning.

---

## Privacy

**planrail runs entirely locally. It makes zero network calls. All data stays on your machine.**

- Communicates via stdio (no ports, no HTTP)
- State stored in local SQLite (`.dag/planrail.db`)
- No telemetry, no analytics, no external APIs
- Open source — audit the code yourself

---

## License

MIT
