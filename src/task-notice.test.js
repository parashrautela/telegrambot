import test from "node:test";
import assert from "node:assert/strict";
import { sendTaskNotice } from "./task-notice.js";
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
