import { chatWithFounder, interpretFounderGroupMessage } from '../integrations/openai.js';
import { sendMessage } from '../integrations/telegram.js';
import crypto from 'node:crypto';
import { escape } from './message-utils.js';

export function createFounderAssistant({ config, founderGroupMessageDrafts, store }) {
  const founderConversation = new Map();
  function founderHistory(chatId) {
    return founderConversation.get(String(chatId)) ?? [];
  }

  function rememberFounderConversation(chatId, role, content) {
    const entries = [
      ...founderHistory(chatId),
      { role, content: String(content).slice(0, 1_200) },
    ].slice(-8);
    founderConversation.set(String(chatId), entries);
  }

  async function founderProjectContext() {
    const projects = await store.rows('Projects');
    return Promise.all(
      projects.slice(-12).map(async (project) => {
        const tasks = await store.tasksForProject(project.ProjectID);
        const current = tasks.find((task) => !['Completed', 'Archived'].includes(task.Status));
        return {
          id: project.ProjectID,
          name: project.ProjectName,
          client: project.ClientName,
          status: project.Status,
          progress: `${tasks.filter((task) => task.Status === 'Completed').length}/${tasks.length}`,
          current_task: current?.TaskName || 'All planned tasks complete',
          current_stage: current?.Stage || 'Handover',
          target_end: project.TargetEndDate || '',
        };
      }),
    );
  }

  async function founderChatReply(message) {
    const chatId = message.chat.id;
    const text = message.text.trim();
    const reply = await chatWithFounder({
      message: text,
      history: founderHistory(chatId),
      projects: await founderProjectContext(),
    });
    rememberFounderConversation(chatId, 'user', text);
    rememberFounderConversation(chatId, 'assistant', reply);
    return sendMessage(config.leaderToken, chatId, escape(reply));
  }

  async function draftFounderGroupMessage(message) {
    const projects = (await store.rows('Projects')).filter(
      (project) => project.GroupChatID && !['Completed', 'Abandoned'].includes(project.Status),
    );
    const interpreted = await interpretFounderGroupMessage({
      message: message.text.trim(),
      projects: projects.map((project) => ({
        id: project.ProjectID,
        name: project.ProjectName,
        client: project.ClientName,
      })),
    });
    if (interpreted.intent !== 'send_group_message') return false;
    const project = projects.find((item) => item.ProjectID === interpreted.project_id);
    if (!project) {
      const choices = projects
        .map((item) => `• ${escape(item.ProjectName)} (<code>${escape(item.ProjectID)}</code>)`)
        .join('\n');
      await sendMessage(
        config.leaderToken,
        message.chat.id,
        `${escape(interpreted.clarification_question || 'Which project group should I send this to?')}\n\n${choices || 'No active project groups are linked yet.'}`,
      );
      return true;
    }
    const text = String(interpreted.message_text || '').trim();
    if (!text || text.length > 3_500) {
      await sendMessage(
        config.leaderToken,
        message.chat.id,
        'I could not prepare a short group message. Please tell me what you want the client or team to hear.',
      );
      return true;
    }
    const draftId = crypto.randomUUID();
    founderGroupMessageDrafts.set(draftId, {
      projectId: project.ProjectID,
      text,
      createdAt: Date.now(),
    });
    await sendMessage(
      config.leaderToken,
      message.chat.id,
      `<b>Ready to send to ${escape(project.ProjectName)}</b>\n\n${escape(text)}\n\nTap Send to post this in the linked Telegram group.`,
      {
        inline_keyboard: [
          [
            {
              text: `Send to ${project.ProjectName}`.slice(0, 55),
              callback_data: `group_send:${draftId}`,
            },
            { text: 'Cancel', callback_data: `group_cancel:${draftId}` },
          ],
        ],
      },
    );
    return true;
  }
  return { founderChatReply, draftFounderGroupMessage };
}
