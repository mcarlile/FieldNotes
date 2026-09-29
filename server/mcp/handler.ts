/**
 * Stateless Streamable HTTP MCP endpoint at POST /mcp.
 *
 * Each request gets a fresh McpServer+transport pair — no session state is
 * kept between calls. Authentication is handled by the existing requireAuth
 * middleware (Bearer token → mobile_tokens table → req.dbUser).
 */

import type { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireAuth } from "../middlewares/clerkAuth";
import { createMcpServer } from "./tools";

export function registerMcpHandler(router: Router): void {
  // POST /mcp — stateless request handler
  router.post("/mcp", requireAuth, async (req: any, res) => {
    const userId: string = req.dbUser.id;

    const server = createMcpServer(userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: no session ID in response
    });

    res.on("close", () => {
      transport.close();
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e: any) {
      console.error("MCP handler error:", e);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: { code: -32603, message: "Internal error" },
        });
      }
    }
  });

  // GET /mcp — SSE not needed for stateless operation
  router.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Use POST for stateless MCP requests" });
  });

  // DELETE /mcp — session termination (N/A for stateless)
  router.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Stateless endpoint: no session to terminate" });
  });
}
