import { openAiConfig } from './config.js';

const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['delay', 'issue', 'complete', 'question', 'unknown'] },
    task_id: { type: 'string', description: 'A supplied task ID, or an empty string if no task is clear.' },
    delay_days: { type: 'integer', minimum: 0, description: 'Delay days, or 0 when not applicable or unknown.' },
    reason: { type: 'string', description: 'Short reason, or an empty string if none is stated.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    clarification_question: { type: 'string', description: 'One concise question, or an empty string when no clarification is needed.' },
  },
  required: ['action', 'task_id', 'delay_days', 'reason', 'confidence', 'clarification_question'],
};

const founderRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['start_project', 'list_projects', 'project_status', 'help', 'unknown'] },
    project_name: { type: 'string' },
    client_name: { type: 'string' },
    start_date: { type: 'string', description: 'ISO date YYYY-MM-DD, or an empty string.' },
    project_id: { type: 'string' },
    reply: { type: 'string' },
  },
  required: ['intent', 'project_name', 'client_name', 'start_date', 'project_id', 'reply'],
};

const groupMessageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['send_group_message', 'unknown'] },
    project_id: { type: 'string', description: 'A ProjectID from the supplied projects, or an empty string if unclear.' },
    message_text: { type: 'string', description: 'The message to post in the project Telegram group, or an empty string.' },
    clarification_question: { type: 'string', description: 'One short question when the project is unclear, otherwise an empty string.' },
  },
  required: ['intent', 'project_id', 'message_text', 'clarification_question'],
};

export function aiEnabled() { return Boolean(openAiConfig()); }

export async function interpretFounderGroupMessage({ message, projects }) {
  const config = openAiConfig();
  if (!config) throw new Error('AI is not configured.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      store: false,
      instructions: [
        'Classify a founder request to send a message to a linked project Telegram group.',
        'Use send_group_message only when the founder actually asks to send, post, ask, tell, or request something from people in a project group.',
        'Resolve project_id only from the supplied projects. If multiple projects exist and the target is unclear, leave project_id empty and ask which project.',
        'Draft a concise group message faithful to the request. Do not invent a deadline, channel, file type, client identity, or promises to follow up unless explicitly requested.',
        'The project group is the delivery channel. Never ask whether to use WhatsApp or email.',
        'Do not claim the message was sent. Return only the JSON schema output.',
      ].join(' '),
      input: JSON.stringify({ projects, founder_message: message }),
      text: { format: { type: 'json_schema', name: 'founder_group_message', strict: true, schema: groupMessageSchema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${await response.text()}`);
  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error(`OpenAI returned no group-message draft (status: ${payload.status ?? 'unknown'}).`);
  return JSON.parse(outputText);
}

export async function interpretProjectUpdate({ project, tasks, message }) {
  const config = openAiConfig();
  if (!config) throw new Error('AI is not configured. Add OPENAI_API_KEY to .env and restart the bot.');
  const taskList = tasks.map((task) => ({
    task_id: task.TaskID,
    task_name: task.TaskName,
    stage: task.Stage,
    status: task.Status,
  }));
  const instructions = [
    'You extract a proposed project update for an interior/construction workflow.',
    'You do not make decisions, approve changes, invent task IDs, or claim that the database was changed.',
    'Choose a task_id only from the supplied task list. If no match is clear, use an empty string and ask one concise clarification question.',
    'Use action delay only when a delay is clearly described. Use delay_days 0 when a delay is not stated or is ambiguous.',
    'Return only the JSON schema output.',
  ].join(' ');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      instructions,
      input: JSON.stringify({ project: { id: project.ProjectID, name: project.ProjectName }, tasks: taskList, user_message: message }),
      text: { format: { type: 'json_schema', name: 'project_update', strict: true, schema: updateSchema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${await response.text()}`);
  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error(`OpenAI returned no structured output (status: ${payload.status ?? 'unknown'}).`);
  return JSON.parse(outputText);
}

export async function interpretFounderRequest(message) {
  const config = openAiConfig();
  if (!config) throw new Error('AI is not configured.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      store: false,
      instructions: [
        'You are a project-operations assistant for a founder using Telegram.',
        'Classify the founder message. Never claim to create, edit, or approve anything.',
        'For start_project, extract only details explicitly stated. Put dates in YYYY-MM-DD only when unambiguous.',
        'For project_status, use a project ID only when the message contains one. Keep reply short and friendly.',
        'Return only the JSON schema output.',
      ].join(' '),
      input: message,
      text: { format: { type: 'json_schema', name: 'founder_request', strict: true, schema: founderRequestSchema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${await response.text()}`);
  const payload = await response.json();
  const outputText = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error(`OpenAI returned no structured output (status: ${payload.status ?? 'unknown'}).`);
  return JSON.parse(outputText);
}

// We deliberately manage a small conversation window in the application instead
// of creating a persistent OpenAI Conversation. That keeps the bot personable
// while making its memory bounded and ephemeral.
export async function chatWithFounder({ message, history, projects }) {
  const config = openAiConfig();
  if (!config) throw new Error('AI is not configured.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      store: false,
      instructions: [
        'You are Iksha, a warm, concise, practical project co-pilot speaking privately with the founder over Telegram.',
        'Talk naturally: greetings, clarification, project discussion, and small talk are welcome. Match the founder’s casual tone without overdoing slang.',
        'Use the supplied project snapshot as the only source of project facts. Never invent project status, people, dates, tasks, approvals, or actions.',
        'You cannot directly change Google Sheets, projects, tasks, plans, roles, or approvals in this chat. For those requests, explain the available guided flow.',
        'The bot has a separate founder-approved action to post to linked project Telegram groups. Never say it cannot post or ask about WhatsApp or email. If the founder asks to post, ask them to name the project and message.',
        'If the request is ambiguous, ask one useful follow-up question. Do not dump commands unless they are the clearest fallback.',
        'Keep replies short enough for Telegram: normally one to four sentences. Use plain text only; no markdown tables.',
      ].join(' '),
      input: JSON.stringify({
        recent_conversation: history,
        current_projects: projects,
        founder_message: message,
      }),
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${await response.text()}`);
  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error(`OpenAI returned no chat response (status: ${payload.status ?? 'unknown'}).`);
  return outputText.trim();
}
