#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConnection, loadConfig, toErrorMessage, type ToolContext } from "./solana.js";
import { registerGetBalance } from "./tools/getBalance.js";
import { registerGetTokenAccounts } from "./tools/getTokenAccounts.js";
import { registerGetTransaction } from "./tools/getTransaction.js";
import { registerRecentActivity } from "./tools/recentActivity.js";
import { registerSimulateTransfer } from "./tools/simulateTransfer.js";

const SERVER_NAME = "solana-mcp-server";
const SERVER_VERSION = "0.1.0";

function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Read-only Solana tools. Nothing is ever signed or sent. " +
        `Connected cluster: ${ctx.config.cluster}.`,
    },
  );

  registerGetBalance(server, ctx);
  registerGetTokenAccounts(server, ctx);
  registerGetTransaction(server, ctx);
  registerRecentActivity(server, ctx);
  registerSimulateTransfer(server, ctx);
  return server;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx: ToolContext = { config, connection: createConnection(config) };
  const server = createServer(ctx);

  // stdout is reserved for the MCP protocol; diagnostics go to stderr.
  console.error(`[${SERVER_NAME}] cluster=${config.cluster} rpc=${redactUrl(config.rpcUrl)}`);
  await server.connect(new StdioServerTransport());

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

/** Hides API keys that some RPC providers put in the query string. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.search.length > 0 ? `${parsed.origin}${parsed.pathname}?<redacted>` : url;
  } catch {
    return "<invalid url>";
  }
}

main().catch((error: unknown) => {
  console.error(`[${SERVER_NAME}] fatal: ${toErrorMessage(error)}`);
  process.exit(1);
});
