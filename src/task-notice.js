import { activeMembership } from "./group-discovery.js";
const invalid = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
export async function sendTaskNotice({ store, token, input }) {
  const groupId = String(input.groupChatId || "");
  if (
    !/^-\d+$/.test(groupId) ||
    typeof input.text !== "string" ||
    !input.text.trim() ||
    input.text.length > 3800 ||
    !Array.isArray(input.recipientIds) ||
    input.recipientIds.length > 30 ||
    input.recipientIds.some((id) => !/^\d+$/.test(id)) ||
    new Set(input.recipientIds).size !== input.recipientIds.length ||
    !Array.isArray(input.files) ||
    input.files.length > 1
  )
    invalid("Invalid task notification.");
  const project = await store.projectForGroup(groupId);
  if (!project || ["Completed", "Abandoned"].includes(project.Status))
    invalid("Choose an active linked project.");
  if (
    input.personalId &&
    (!/^\d+$/.test(input.personalId) ||
      !input.recipientIds.includes(input.personalId))
  )
    invalid("Choose a project attendee.");
  const call = async (method, options) => {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        ...options,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new Error("Telegram did not confirm this notification.");
    return data.result;
  };
  const members = [];
  const found = await Promise.all(
    input.recipientIds.map((id) =>
      call("getChatMember", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: groupId, user_id: id }),
      }),
    ),
  );
  for (let index = 0; index < input.recipientIds.length; index++) {
    const id = input.recipientIds[index],
      member = found[index];
    if (!activeMembership(member) || member.user?.is_bot)
      invalid("A selected recipient is no longer in this group.");
    members.push({ id, user: member.user });
  }
  const files = input.files.map((file) => {
    if (
      !file ||
      typeof file.name !== "string" ||
      !file.name ||
      file.name.length > 180 ||
      /[\x00-\x1f/\\]/.test(file.name) ||
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        file.type,
      ) ||
      typeof file.data !== "string" ||
      file.data.length > 7_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)
    )
      invalid("Invalid notification file.");
    const bytes = Buffer.from(file.data, "base64");
    if (
      bytes.length > 5 * 1024 * 1024 ||
      bytes.toString("base64") !== file.data
    )
      invalid("Notification files must be under 5 MB.");
    return { ...file, bytes };
  });
  let text = input.text.trim();
  const entities = [];
  if (!input.personalId)
    for (const member of members) {
      const name =
        [member.user.first_name, member.user.last_name]
          .filter(Boolean)
          .join(" ") || member.id;
      text += "\n";
      entities.push({
        type: "text_mention",
        offset: text.length,
        length: name.length,
        user: member.user,
      });
      text += name;
    }
  if (text.length > 4000) invalid("Shorten the message or select fewer tags.");
  const chat_id = input.personalId || groupId;
  const messageIds = [
    (
      await call("sendMessage", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id, text, entities }),
      })
    ).message_id,
  ];
  for (const file of files) {
    const form = new FormData();
    form.set("chat_id", chat_id);
    form.set(
      "document",
      new Blob([file.bytes], { type: file.type }),
      file.name,
    );
    messageIds.push((await call("sendDocument", { body: form })).message_id);
  }
  return { messageIds };
}
