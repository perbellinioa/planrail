#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, setStateDir } from "./server.js";

function main(): void {
  const args = process.argv.slice(2);

  // Parse --state-dir
  const stateDirIdx = args.indexOf("--state-dir");
  if (stateDirIdx !== -1 && args[stateDirIdx + 1]) {
    setStateDir(args[stateDirIdx + 1]);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error("Failed to start planrail:", err);
    process.exit(1);
  });
}

main();
