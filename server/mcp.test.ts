import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test@localhost:1/test";
const { handleRpc } = await import("./mcp");
const { generateApiToken, hashApiToken, API_TOKEN_PREFIX } = await import("./apiTokens");

test("MCP initialize negotiates a supported protocol version", async () => {
  const response: any = await handleRpc({
    jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" },
  });
  assert.equal(response.result.protocolVersion, "2025-03-26");
  assert.deepEqual(response.result.capabilities, { tools: {} });

  const fallback: any = await handleRpc({
    jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" },
  });
  assert.equal(fallback.result.protocolVersion, "2025-06-18");
});

test("MCP lists the project and upload tools", async () => {
  const response: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(
    response.result.tools.map((t: { name: string }) => t.name),
    ["list_projects", "get_project", "request_upload", "create_project", "set_route", "add_clip", "move_clip", "reprocess_clip"],
  );
});

test("MCP notifications get no response and bad tool arguments are tool errors", async () => {
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const response: any = await handleRpc({
    jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "add_clip", arguments: { project_id: "p" } },
  });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /^Invalid arguments/);
  const unknown: any = await handleRpc({ jsonrpc: "2.0", id: 4, method: "nope" });
  assert.equal(unknown.error.code, -32601);
});

test("MCP trip tools need a signed-in user", async () => {
  const response: any = await handleRpc({
    jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_projects", arguments: {} },
  });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /Sign in/);
});

test("API tokens are random, prefixed, and stored only as a hash", () => {
  const a = generateApiToken();
  const b = generateApiToken();
  assert.ok(a.token.startsWith(API_TOKEN_PREFIX));
  assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, hashApiToken(a.token));
  assert.equal(a.tokenHash.length, 64);
  assert.ok(!a.tokenHash.includes(a.token));
  assert.equal(a.tokenPrefix, a.token.slice(0, 10));
});
