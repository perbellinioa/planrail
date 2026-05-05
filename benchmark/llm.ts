import OpenAI from "openai";
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

function getGitHubToken(): string {
  try {
    return execSync("gh auth token", { encoding: "utf-8" }).trim();
  } catch {
    throw new Error("Failed to get GitHub token. Run 'gh auth login' first.");
  }
}

export function createLlmClient(model?: string): LlmClient {
  // Default: GitHub Models API with gh auth token
  const apiKey = process.env.OPENAI_API_KEY || getGitHubToken();
  const baseURL = process.env.LLM_BASE_URL || "https://models.github.ai/inference";
  const resolvedModel = model || process.env.LLM_MODEL || "openai/gpt-4o";

  const client = new OpenAI({ apiKey, baseURL });
  const history: LlmCall[] = [];

  return {
    model: resolvedModel,

    async call(prompt: string): Promise<LlmCall> {
      const start = Date.now();
      const response = await client.chat.completions.create({
        model: resolvedModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 4096,
      });

      const result: LlmCall = {
        prompt,
        response: response.choices[0]?.message?.content || "",
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
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
