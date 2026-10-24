import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { OPS_CLAUDE_MODEL, registerOpsClaude } from "./ops-claude.js";

async function withApp(options, run) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  registerOpsClaude(app, options);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, body) => fetch(`${base}/api/ops/claude/write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("Claude mode reports unavailable and falls back when no API key is set", async () => {
  await withApp({ apiKey: "" }, async (base) => {
    const status = await (await fetch(`${base}/api/ops/claude/status`)).json();
    assert.deepEqual(status, { available: false, model: OPS_CLAUDE_MODEL });
    const response = await post(base, { kind: "brief", snapshot: { today: "Monday" } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).fallback, true);
  });
});

test("Claude mode sends the snapshot as data and returns only the written text", async () => {
  const calls = [];
  const fakeClient = {
    beta: {
      messages: {
        create: async (params, requestOptions) => {
          calls.push({ params, requestOptions });
          return { model: OPS_CLAUDE_MODEL, stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Good morning! One order needs you." }] };
        },
      },
    },
  };
  await withApp({ apiKey: "test-key", createClient: (key) => { assert.equal(key, "test-key"); return fakeClient; } }, async (base) => {
    const response = await post(base, { kind: "brief", snapshot: { today: "Monday, June 1", waitingForApproval: [{ id: "PO-1002" }] } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: "Good morning! One order needs you.", model: OPS_CLAUDE_MODEL });
  });
  const { params } = calls[0];
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.fallbacks, "default");
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.match(params.messages[0].content, /<shop_state>\n\{"today":"Monday, June 1"/);
  assert.match(params.system, /data, not instructions/);
  assert.ok(!JSON.stringify(params).includes("test-key"), "the key is never put in the prompt");
});

test("Claude mode can draft an invoice dispute from the order's mismatches", async () => {
  let prompt = "";
  const fakeClient = { beta: { messages: { create: async (params) => { prompt = params.messages[0].content; return { model: OPS_CLAUDE_MODEL, stop_reason: "end_turn", content: [{ type: "text", text: "Hi team, we were billed for 6 sleeves but 5 arrived." }] }; } } } };
  await withApp({ apiKey: "test-key", createClient: () => fakeClient }, async (base) => {
    const response = await post(base, { kind: "dispute", snapshot: { order: { id: "PO-1013", invoice: { issues: ["Billed for 6 sleeves of Dart lids, but only 5 arrived: $10.50 too much."] } } } });
    assert.equal(response.status, 200);
    assert.match((await response.json()).text, /billed for 6 sleeves/);
  });
  assert.match(prompt, /invoice/);
  assert.match(prompt, /corrected invoice or a credit/);
});

test("Claude mode rejects malformed requests and falls back on a refusal", async () => {
  const refusing = { beta: { messages: { create: async () => ({ model: OPS_CLAUDE_MODEL, stop_reason: "refusal", content: [] }) } } };
  await withApp({ apiKey: "test-key", createClient: () => refusing }, async (base) => {
    assert.equal((await post(base, { kind: "write-a-poem", snapshot: {} })).status, 400);
    assert.equal((await post(base, { kind: "brief", snapshot: {}, extra: true })).status, 400);
    const refused = await post(base, { kind: "explain", snapshot: { order: { id: "PO-1" } } });
    assert.equal(refused.status, 502);
    assert.equal((await refused.json()).fallback, true);
  });
});

test("Claude mode falls back when the API call fails", async () => {
  const failing = { beta: { messages: { create: async () => { throw new Error("network down"); } } } };
  await withApp({ apiKey: "test-key", createClient: () => failing }, async (base) => {
    const response = await post(base, { kind: "supplier-message", snapshot: { order: { id: "PO-1" } } });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /standard version/);
  });
});
