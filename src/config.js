import 'node:process';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export function googleConfig() {
  return {
    sheetId: required('GOOGLE_SHEET_ID'),
    serviceAccountEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    privateKey: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  };
}

export function botConfig() {
  return {
    leaderToken: required('LEADER_BOT_TOKEN'),
    groupToken: required('GROUP_BOT_TOKEN'),
    founderTelegramId: required('FOUNDER_TELEGRAM_ID'),
  };
}

export function openAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return { apiKey, model: process.env.OPENAI_MODEL || 'gpt-5-mini' };
}
