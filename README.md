# Studio Iksha Telegram Operations

Studio Iksha is a two-bot Telegram workspace for construction and interior projects. The founder manages projects privately; teams work inside one Telegram group per project. Google Sheets is the system of record.

## Features

- Project creation from the built-in 15-step house workflow.
- Google Sheets tracking for projects, tasks, dates, delays, issues, approvals, users, onboarding, and audit logs.
- A conversational founder assistant for normal chat, project questions, clarifications, and small talk, alongside plain-English project requests.
- Group updates through commands or a plain-English mention of the group bot.
- AI drafts require confirmation before changing a task; delay requests also need founder approval.
- New-member onboarding: project TLDR in the group, private founder role approval, and a pending state until approved.
- Railway-ready, always-on deployment.

## Architecture

```text
Founder ── private chat ── Founder bot ──┐
                                         ├── Google Sheets
Project team ── project group ── Group bot ┘
```

| Component | Purpose |
| --- | --- |
| Founder bot | Project setup, project status, approvals, and member-role approval. |
| Group bot | Group onboarding, task updates, delays, and issues. |
| Google Sheets | Persistent project data and audit trail. |
| OpenAI API | Powers founder conversation and turns supported group updates into safe structured drafts. |
| Railway | Production hosting. |

## Everyday flows

### Create a project

1. Create a Telegram group and add the group bot.
2. Send `/start` in that group to register it.
3. In the founder bot, write:

   ```text
   Create a project called Parash ka ghar for Parash, starting 22 September
   ```

4. Answer any missing questions and select the registered group.
5. The project and its default tasks are created in Google Sheets.

### Report an update

In the project group, mention the group bot:

```text
@Ikshagroup123_bot painting work is delayed by 2 days because of rain
```

The bot proposes a completion, delay, or issue. Press **Confirm** to submit it. Delays are sent to the founder for approval.

### Onboard a new member

When a person joins a linked project group, the group bot posts a TLDR with progress, current stage, current task, blockers, and next milestone. The founder receives an **Assign role** button and replies:

```text
Rahul Sharma | Electrical contractor
```

The member is then saved in Google Sheets and activated. New members remain pending until the founder assigns their profile.

> Make the group bot an administrator in every project group. Telegram only delivers member-join events to administrator bots.

## Founder bot

Use normal English for common actions, or these commands as a fallback:

The founder bot keeps a short, in-memory window of the recent private chat so follow-up questions feel natural. It receives a compact live project snapshot with each AI reply; this memory clears whenever the Railway service restarts. The API request uses `store: false`. The assistant can discuss work freely, but it cannot make a project, task, role, approval, or Sheets change without the bot’s existing guided flow or confirmation.

| Command | Purpose |
| --- | --- |
| `/start`, `/help` | Show help. |
| `/createproject` | Guided project creation. |
| `/projects` | List projects. |
| `/project P001` | View a project. |
| `/adduser ID \| Name \| Role` | Add or update a user. |
| `/role ID \| New role` | Change an active member’s role. |
| `/approvals` | List pending approvals. |
| `/cancel` | Cancel project creation. |

## Group bot

| Command or message | Purpose |
| --- | --- |
| `/start` | Register a group or confirm its project link. |
| `/tasks` | List active tasks. |
| `/done TASK_ID` | Mark a permitted task complete. |
| `/delay TASK_ID DAYS reason` | Request a delay approval. |
| `/issue TASK_ID description` | Record an issue. |
| `@group_bot plain-English update` | Create a confirmable action draft. |

## Google Sheets tabs

| Tab | Contents |
| --- | --- |
| `Projects` | Project identity, dates, leader, and group link. |
| `WorkflowTemplates` | Reusable project workflow. |
| `Tasks` | Generated task plan and status. |
| `Users` | Active Telegram users and roles. |
| `MemberOnboarding` | Join events and founder approvals. |
| `GroupRegistry` | Groups available for project linking. |
| `Approvals` | Delay approvals. |
| `AuditLog` | Operational history. |

## Setup

### Requirements

- Node.js 20+.
- Two bots created with `@BotFather`.
- A Google Cloud service account with Google Sheets API enabled.
- A Google Sheet shared as **Editor** with the service-account email.
- An OpenAI API key for plain-English interpretation.

Copy `.env.example` to `.env` and set:

```dotenv
LEADER_BOT_TOKEN=
GROUP_BOT_TOKEN=
FOUNDER_TELEGRAM_ID=
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
```

Use the numeric ID from `@userinfobot` as `FOUNDER_TELEGRAM_ID`. Keep `\\n` escapes in `GOOGLE_PRIVATE_KEY`.

```sh
npm run setup-sheet
npm run seed-workflow
npm run check
npm run start:local
```

Do not run a local bot while Railway is polling the same token. Telegram permits only one `getUpdates` listener per token.

## Railway deployment

1. Connect this repository to Railway.
2. Add the environment variables in Railway **Variables**.
3. Use `npm start` as the start command.
4. Keep one service replica.
5. Promote the group bot to administrator in each project group.

Railway does not read the local `.env` file.

## Security

- Never commit or share `.env`, bot tokens, OpenAI keys, or Google private keys.
- If a Telegram token leaks, use `@BotFather` → `/revoke`, replace it in Railway, and redeploy.
- If a Google private key leaks, delete and replace the service-account key in Google Cloud.
- Founder actions are restricted by `FOUNDER_TELEGRAM_ID`.
- AI drafts are not executed until a person confirms them. Founder chat memory is short-lived in the running service and OpenAI requests use `store: false`.
- Operational changes are recorded in `AuditLog`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Bot is silent | Check Railway logs, bot tokens, and `FOUNDER_TELEGRAM_ID`. |
| `Conflict: terminated by other getUpdates request` | Stop other listeners; revoke and replace the token if necessary. |
| `Telegram getMe failed: Not Found` | Replace the invalid token with the complete BotFather token. |
| New-member onboarding does not run | Promote the group bot to administrator. |
| Plain-English request falls back | Retry with clearer wording or use the matching command. |

## Current boundaries

This production pilot does not yet automatically reschedule downstream tasks, create Calendar events, create rework tasks, assign tasks from roles automatically, or offer multiple workflow templates. Planned next work includes a template library, role-to-task assignment, dependency-aware rescheduling, calendar sync, and richer group-agent conversations.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Production start. |
| `npm run start:local` | Local start with `.env`. |
| `npm run check` | Syntax checks. |
| `npm run setup-sheet` | Creates/updates Sheets tabs and headers. |
| `npm run seed-workflow` | Seeds the house workflow. |

## License

Private project. All rights reserved.
