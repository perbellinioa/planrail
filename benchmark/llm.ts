import { execSync } from "node:child_process";

export interface LlmCall {
  prompt: string;
  response: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
}

export interface LlmClient {
  model: string;
  call(prompt: string): Promise<LlmCall>;
  totalTokens(): { input: number; output: number; total: number };
  calls(): LlmCall[];
}

export function createLlmClient(model?: string): LlmClient {
  const resolvedModel = model || process.env.LLM_MODEL || "claude-opus-4.7";
  const history: LlmCall[] = [];

  return {
    model: resolvedModel,

    async call(prompt: string): Promise<LlmCall> {
      const start = Date.now();

      // Use Copilot CLI in non-interactive mode
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      let response: string;
      try {
        // Redirect stderr to stdout to capture Copilot CLI footer (token info)
        response = execSync(
          `copilot -p '${escapedPrompt}' --model ${resolvedModel} 2>&1`,
          { encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 300_000 },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Copilot CLI call failed: ${msg}`);
      }

      // Parse token info from Copilot CLI footer (e.g. "Tokens    ↑ 1.2k • ↓ 500 • 0 (cached)")
      // Match the last Tokens line (there may be multiple from Copilot session info)
      const tokenLines = response.match(/Tokens\s+.+/g);
      let inputTokens = 0;
      let outputTokens = 0;
      if (tokenLines) {
        const lastLine = tokenLines[tokenLines.length - 1];
        const numbers = lastLine.match(/([\d.]+k?)/g);
        if (numbers && numbers.length >= 2) {
          inputTokens = parseTokenCount(numbers[0]);
          outputTokens = parseTokenCount(numbers[1]);
        }
      }

      // Strip the Copilot CLI footer (Changes/Requests/Tokens lines)
      const cleanResponse = response
        .replace(/\n*Changes\s+\+\d+\s+-\d+[\s\S]*$/, "")
        .trim();

      const result: LlmCall = {
        prompt,
        response: cleanResponse,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        duration_ms: Date.now() - start,
      };
      history.push(result);
      return result;
    },

    totalTokens() {
      const input = history.reduce((sum, c) => sum + c.input_tokens, 0);
      const output = history.reduce((sum, c) => sum + c.output_tokens, 0);
      return { input, output, total: input + output };
    },

    calls() {
      return history;
    },
  };
}

function parseTokenCount(s: string): number {
  if (s.endsWith("k")) {
    return Math.round(parseFloat(s.slice(0, -1)) * 1000);
  }
  return parseInt(s, 10) || 0;
}

export function parseFiles(response: string): Map<string, string> {
  const files = new Map<string, string>();

  // Pattern 1: ```filepath\n...\n``` (filepath on the opening fence line)
  const regex1 = /```\s*(\S+\.\S+)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex1.exec(response)) !== null) {
    files.set(match[1], match[2].trim());
  }

  // Pattern 2: **`filepath`** or `filepath` followed by ```\n...\n```
  if (files.size === 0) {
    const regex2 = /(?:\*\*)?`([^`]+\.[^`]+)`(?:\*\*)?[:\s]*\n```[\w]*\n([\s\S]*?)```/g;
    while ((match = regex2.exec(response)) !== null) {
      files.set(match[1], match[2].trim());
    }
  }

  // Pattern 3: ### filepath or ## filepath followed by ```\n...\n```
  if (files.size === 0) {
    const regex3 = /#{1,4}\s+`?(\S+\.\S+)`?\s*\n+```[\w]*\n([\s\S]*?)```/g;
    while ((match = regex3.exec(response)) !== null) {
      files.set(match[1], match[2].trim());
    }
  }

  return files;
}
