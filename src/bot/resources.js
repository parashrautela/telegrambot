import { sendPhoto, sendDocument, sendMessage } from '../integrations/telegram.js';
import { archiveProjectResource } from '../integrations/drive-storage.js';
import { retryProjectResources } from '../integrations/project-resources.js';
import { escape, groupOnly, actor } from './message-utils.js';

export function createResourceHandlers({ config, store }) {
  async function shareWorkflowResources(project, workflowId) {
    const resources = await store.resourcesForWorkflow(workflowId);
    for (const resource of resources) {
      const caption = `<b>${escape(resource.Title)}</b>${resource.Description ? `\n${escape(resource.Description)}` : ''}`;
      try {
        if (resource.ResourceType.toLowerCase() === 'photo')
          await sendPhoto(config.groupToken, project.GroupChatID, resource.UrlOrFileId, caption);
        else if (resource.ResourceType.toLowerCase() === 'document')
          await sendDocument(config.groupToken, project.GroupChatID, resource.UrlOrFileId, caption);
        else
          await sendMessage(
            config.groupToken,
            project.GroupChatID,
            `${caption}\n${escape(resource.UrlOrFileId)}`,
          );
      } catch (error) {
        console.error(`Could not share resource ${resource.ResourceID}:`, error.message);
      }
    }
  }

  async function requestClientResources(project, workflow) {
    const resourceTask = workflow.find((task) => task.Stage === 'Resources');
    if (!resourceTask) return;
    await sendMessage(
      config.groupToken,
      project.GroupChatID,
      `<b>First step — project resources</b>\n\nHi <b>${escape(project.ClientName || 'there')}</b> 👋 Please share all relevant project material here so we can begin: plans, drawings, photos, measurements, approvals, reference images, and existing documents.\n\nThis is the first task in the <b>${escape(project.ProjectName)}</b> workflow. You can send files and photos directly in this group; I’ll log them for the project team.`,
    );
  }

  async function handleProjectResourceUpload(message) {
    if (!groupOnly(message.chat) || (!message.document && !message.photo?.length)) return;
    const project = await store.projectForGroup(message.chat.id);
    if (!project || ['Completed', 'Abandoned'].includes(project.Status)) return;
    const user = actor(message.from);
    const roster = await store.groupMember(message.chat.id, message.from.id);
    const maySubmit =
      String(message.from.id) === config.founderTelegramId ||
      (roster?.MembershipStatus === 'Active' && Boolean(roster.AssignedRole));
    if (!maySubmit) return;
    const task = (await store.tasksForProject(project.ProjectID)).find(
      (item) => item.Stage === 'Resources' && item.Status !== 'Completed',
    );
    const document = message.document;
    const photo = message.photo?.at(-1);
    const resourceType = document ? 'Document' : 'Photo';
    const fileId = document?.file_id || photo?.file_id;
    const fileName = (document?.file_name || `photo-${message.message_id}.jpg`).slice(0, 200);
    const submission = await store.saveSubmittedResource({
      projectId: project.ProjectID,
      taskId: task?.TaskID || '',
      groupChatId: message.chat.id,
      user,
      resourceType,
      fileId,
      fileName,
      caption: message.caption || '',
      sourceMessageId: message.message_id,
      mimeType: document?.mime_type || 'image/jpeg',
    });
    if (!submission.created) return;
    if (task)
      await store.updateRow('Tasks', task.rowNumber, {
        Status: 'Resources received — Review needed',
        LastUpdatedAt: new Date().toISOString(),
        LastUpdatedBy: String(user.id),
      });
    await store.audit({
      projectId: project.ProjectID,
      taskId: task?.TaskID || '',
      action: 'Project resource submitted',
      actor: user.id,
      actorName: user.name,
      source: 'Telegram group bot',
      details: `${resourceType}: ${fileName}`,
    });
    await sendMessage(
      config.groupToken,
      message.chat.id,
      `✅ ${escape(fileName)} is logged for this project and queued for automatic Google Drive storage. Check Files in the web app for its save status.`,
    );
    retryProjectResources(store, archiveProjectResource).catch(() =>
      console.warn('Project file storage retry pending.'),
    );
  }

  return { shareWorkflowResources, requestClientResources, handleProjectResourceUpload };
}
