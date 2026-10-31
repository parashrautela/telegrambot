import { botConfig } from '../config/environment.js';
import { SheetStore } from '../storage/sheets.js';
import { getMe, poll, sendMessage } from '../integrations/telegram.js';
import {
  parseDecisionRequest,
  captureDecisionRequest,
  syncCapturedDecisionRequest,
  parseGroupRequest,
  retryDecisionRequestSync,
} from '../integrations/decision-requests.js';
import { startWebBridge } from '../integrations/web-bridge.js';
import { escape, groupOnly } from './message-utils.js';

import { createGroupRegistry } from './group-registry.js';
import { createFounderAssistant } from './founder-assistant.js';
import { createProjectHandlers } from './projects.js';
import { createMembershipHandlers } from './membership.js';
import { createResourceHandlers } from './resources.js';
import { createGroupHandlers } from './group-commands.js';
import { createFounderHandlers } from './founder-commands.js';

export async function startBot() {
  const config = botConfig();
  const store = new SheetStore();
  const founderGroupMessageDrafts = new Map();
  const groupBotProfile = await getMe(config.groupToken);
  const leaderBotProfile = await getMe(config.leaderToken);
  const groupBotMention = `@${groupBotProfile.username}`.toLowerCase();
  const { syncGroupRoster, recordGroupMember, discoverGroup } = createGroupRegistry({
    config,
    groupBotProfile,
    store,
  });
  const { founderChatReply, draftFounderGroupMessage } = createFounderAssistant({
    config,
    founderGroupMessageDrafts,
    store,
  });
  const {
    nextProjectId,
    projectTldr,
    planOverview,
    isUntouchedLegacyPlan,
    askFounderForPlan,
    showProjects,
  } = createProjectHandlers({ config, store });
  const {
    recoverFounderDepartureAlerts,
    welcomeNewProjectMember,
    handleFounderGroupDeparture,
    changeUserRole,
    changeRoleByName,
  } = createMembershipHandlers({ config, leaderBotProfile, projectTldr, store });
  const { shareWorkflowResources, requestClientResources, handleProjectResourceUpload } =
    createResourceHandlers({ config, store });
  const { requireProject, interpretNaturalLanguage, groupCommand, groupCallback } =
    createGroupHandlers({ config, recordGroupMember, store });
  const { leaderCommand, leaderNaturalLanguageReply, leaderCallback } = createFounderHandlers({
    askFounderForPlan,
    changeRoleByName,
    changeUserRole,
    config,
    draftFounderGroupMessage,
    founderChatReply,
    founderGroupMessageDrafts,
    isUntouchedLegacyPlan,
    nextProjectId,
    planOverview,
    requestClientResources,
    shareWorkflowResources,
    showProjects,
    store,
  });

  console.log(`Project group bot connected as @${groupBotProfile.username}.`);
  console.log(
    `Founder bot connected as @${leaderBotProfile.username}; founder Telegram ID is ${config.founderTelegramId}.`,
  );
  await store.ensureSchema();
  await store.seedDefaultWorkflows();
  await recoverFounderDepartureAlerts();
  poll(config.groupToken, 'Project group bot', async (update) => {
    await discoverGroup(update);
    if (update.message) {
      let request;
      try {
        request = parseDecisionRequest(update.message, groupBotProfile.username);
      } catch (error) {
        await sendMessage(config.groupToken, update.message.chat.id, escape(error.message));
        return;
      }
      if (request) {
        const project = await requireProject(update.message.chat, config.groupToken);
        if (!project) return;
        const result = await captureDecisionRequest(store, project, request);
        let sync;
        try {
          sync = await syncCapturedDecisionRequest(store, project, result.request);
        } catch (error) {
          console.error(error.message);
          await sendMessage(
            config.groupToken,
            update.message.chat.id,
            `Saved request <code>${escape(request.RequestID)}</code> in the bot, but the web app has not received it. Retry the same command later.`,
          );
          return;
        }
        if (!sync.configured)
          console.warn(`Query ${request.RequestID} saved locally; web sync is not configured.`);
        return;
      }
    }
    if (update.message && groupOnly(update.message.chat)) {
      const project = await store.projectForGroup(String(update.message.chat.id));
      if (project && !['Completed', 'Abandoned'].includes(project.Status)) {
        const request = parseGroupRequest(update.message, project, groupBotProfile.username);
        if (request) {
          const result = await captureDecisionRequest(store, project, request);
          try {
            await syncCapturedDecisionRequest(store, project, result.request);
          } catch {
            console.warn(`Group message saved; web sync pending: ${request.RequestID}`);
          }
        }
      }
    }
    if (update.message) await handleProjectResourceUpload(update.message);
    if (update.message?.text) {
      const mentioned = update.message.text.toLowerCase().includes(groupBotMention);
      console.log(
        `Group bot received update ${update.update_id} in ${update.message.chat.type}; mentioned: ${mentioned}; command: ${update.message.text.startsWith('/')}.`,
      );
    }
    if (update.message?.text?.startsWith('/')) await groupCommand(update.message);
    else if (update.message?.text) {
      const text = update.message.text.trim();
      const isMention = text.toLowerCase().includes(groupBotMention);
      const isReplyToBot =
        update.message.reply_to_message?.from?.username === groupBotProfile.username;
      if (isMention || isReplyToBot) {
        const project = await requireProject(update.message.chat, config.groupToken);
        const naturalLanguageUpdate = text
          .replaceAll(new RegExp(groupBotMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
          .trim();
        if (project && /\b(status|update|progress|going)\b/i.test(naturalLanguageUpdate)) {
          await sendMessage(config.groupToken, update.message.chat.id, await projectTldr(project));
          return;
        }
        if (project && naturalLanguageUpdate)
          await interpretNaturalLanguage(update.message, project, naturalLanguageUpdate);
      }
    }
    if (update.callback_query) await groupCallback(update.callback_query);
    if (update.chat_member) {
      await handleFounderGroupDeparture(update);
      await welcomeNewProjectMember(update);
    }
  });
  startWebBridge({
    store,
    token: config.groupToken,
    founderTelegramId: config.founderTelegramId,
    onClientReady: (project, clientName) => askFounderForPlan({ project, clientName }),
  });
  setInterval(() => syncGroupRoster().catch((error) => console.warn(error.message)), 60_000);
  syncGroupRoster().catch((error) => console.warn(error.message));
  setInterval(
    () =>
      retryDecisionRequestSync(store).catch(() =>
        console.warn('Request sync retry failed; will retry next minute.'),
      ),
    60_000,
  );
  retryDecisionRequestSync(store).catch(() =>
    console.warn('Request sync retry failed; will retry next minute.'),
  );
  poll(config.leaderToken, 'Founder bot', async (update) => {
    if (update.message?.text?.startsWith('/')) await leaderCommand(update.message);
    else if (update.message?.text) await leaderNaturalLanguageReply(update.message);
    if (update.callback_query) await leaderCallback(update.callback_query);
  });
}
