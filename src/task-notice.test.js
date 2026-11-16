import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { sendTaskNotice } from "./task-notice.js";
import { startWebBridge } from "./web-bridge.js";
test("task notices verify project recipients, send files as multipart and cannot leak markup through mentions", async (t) => {
  const original = fetch,
    calls = [];
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/getChatMember"))
      return Response.json({
        ok: true,
        result: {
          status: "member",
          user: { id: 7, first_name: "Sam <Admin> 😀", is_bot: false },
        },
      });
    return Response.json({ ok: true, result: { message_id: calls.length } });
  };
  const base = {
      groupChatId: "-1",
      text: "Wall reference <internal>",
      recipientIds: ["7"],
      files: [
        {
          name: "wall.pdf",
          type: "application/pdf",
          data: Buffer.from("%PDF-1.7").toString("base64"),
        },
      ],
    },
    store = {
      projectForGroup: async () => ({ ProjectID: "p", Status: "Active" }),
    };
  const result = await sendTaskNotice({ store, token: "fake", input: base });
  assert.equal(result.messageIds.length, 2);
  const sent = JSON.parse(
    calls.find((row) => row.url.endsWith("/sendMessage")).options.body,
  );
  assert.equal(sent.parse_mode, undefined);
  assert.equal(sent.entities[0].type, "text_mention");
  assert.equal(sent.text.slice(sent.entities[0].offset), "Sam <Admin> 😀");
  const form = calls.find((row) => row.url.endsWith("/sendDocument")).options
    .body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("document").name, "wall.pdf");
  assert.equal(form.get("chat_id"), "-1");
  const before = calls.length;
  await assert.rejects(
    sendTaskNotice({
      store,
      token: "fake",
      input: { ...base, personalId: "99" },
    }),
  );
  assert.equal(calls.length, before);
  await assert.rejects(
    sendTaskNotice({
      store: { projectForGroup: async () => null },
      token: "fake",
      input: base,
    }),
  );
});
test("departed attendees are refused before any notification; partial send failure is surfaced", async (t) => {
  const original = fetch;
  let sends = 0,
    left = true;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/getChatMember"))
      return Response.json({
        ok: true,
        result: {
          status: left ? "left" : "member",
          user: { id: 7, first_name: "Sam" },
        },
      });
    sends++;
    if (String(url).endsWith("/sendDocument"))
      throw Error("timeout after first message");
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  const input = {
      groupChatId: "-1",
      text: "Site meeting",
      recipientIds: ["7"],
      files: [
        {
          name: "a.pdf",
          type: "application/pdf",
          data: Buffer.from("%PDF-1.7").toString("base64"),
        },
      ],
    },
    store = { projectForGroup: async () => ({ Status: "Active" }) };
  await assert.rejects(sendTaskNotice({ store, token: "fake", input }));
  assert.equal(sends, 0);
  left = false;
  await assert.rejects(sendTaskNotice({ store, token: "fake", input }));
  assert.equal(sends, 2);
});

// The route itself: the first release had the sender but no route, so every send answered "Not found".
test("the bridge route posts to the group and tags the selected people, and needs the secret", async (t) => {
  const reserve = net.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const prior = { secret: process.env.INTEGRATION_SHARED_SECRET, port: process.env.BOT_BRIDGE_PORT, fetch: globalThis.fetch };
  process.env.INTEGRATION_SHARED_SECRET = "route-secret";
  process.env.BOT_BRIDGE_PORT = String(port);
  const telegram = [];
  globalThis.fetch = async (url, options) => {
    telegram.push({ url: String(url), body: options?.body });
    if (String(url).endsWith("/getChatMember"))
      return Response.json({ ok: true, result: { status: "member", user: { id: 7, first_name: "Asha", is_bot: false } } });
    return Response.json({ ok: true, result: { message_id: 42 } });
  };
  const server = startWebBridge({ store: { projectForGroup: async () => ({ ProjectID: "p", Status: "Active" }) }, token: "fake", founderTelegramId: "1" });
  t.after(() => {
    server.close();
    globalThis.fetch = prior.fetch;
    for (const [key, value] of [["INTEGRATION_SHARED_SECRET", prior.secret], ["BOT_BRIDGE_PORT", prior.port]]) value === undefined ? delete process.env[key] : (process.env[key] = value);
  });
  const post = async (headers) => {
    const response = await prior.fetch(`http://127.0.0.1:${port}/api/integrations/web/task-notice`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ groupChatId: "-100", text: "Please share the property plans", recipientIds: ["7"], files: [] }),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await post({})).status, 401);
  assert.equal(telegram.length, 0, "nothing reaches Telegram without the secret");
  const sent = await post({ authorization: "Bearer route-secret" });
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.body, { messageIds: [42] });
  const message = JSON.parse(telegram.find((row) => row.url.endsWith("/sendMessage")).body);
  assert.equal(message.chat_id, "-100");
  assert.match(message.text, /^Please share the property plans\nAsha$/);
  assert.deepEqual(message.entities.map((entity) => [entity.type, entity.user.id]), [["text_mention", 7]]);
});
