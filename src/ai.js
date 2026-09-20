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

export function aiEnabled() { return Boolean(openAiConfig()); }

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
  if (!payload.output_text) throw new Error('OpenAI returned no structured output.');
  return JSON.parse(payload.output_text);
}
