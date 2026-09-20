# Studio Iksha Telegram Operations — pilot

This is a deliberately small, working foundation for the project workflow system:

- **Founder bot**: private admin view and schedule-change approvals for Parash.
- **Project group bot**: used in a project Telegram group by the designer, architect, client, and site team.
- **One Google Sheet**: the shared system of record for projects, workflow templates, generated tasks, users, approvals, and audit history.

The build does not make Telegram the database. It records every operational action in the Sheet, and the Calendar/rescheduling engine can be added on top of the same task model.

## Current pilot flow

1. A team member runs `/tasks` in the project group.
2. They run `/done TASK_ID` when their task is complete, or `/delay TASK_ID DAYS reason` if it slips.
3. A delay creates an approval request for the project lead or founder.
4. The founder receives an Approve / Reject message in the private bot.
5. The decision, actor, and reason are stored in the shared Sheet and posted back to the project group.

`/issue TASK_ID description` records an issue and informs the project lead. The next increment is to create a rework task from an approved issue, then add dependency-aware rescheduling and Calendar sync.

## Intelligence layer

The first AI feature is intentionally a **drafting layer**, not a decision-maker. In a project group, mention the group bot or reply to one of its messages:

```text
@Jejdidjududh_bot Tiles have not arrived, so the kitchen flooring will be delayed by three days.
```

The bot matches the note to the project task list and proposes a structured delay, issue, or completion. It then shows <b>Confirm</b> and <b>Cancel</b> buttons. It never changes the Sheet from an AI response alone, preserving the audit trail and founder approval flow.

Add a newly created OpenAI API key locally in `.env` as `OPENAI_API_KEY`, then restart the bot. The starter defaults to `gpt-5-mini`, a cost-optimized model that supports Structured Outputs. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-5-mini)

## Setup

### Security first

Never paste Telegram tokens or Google service-account private keys into a chat, commit, or screenshot. Store them only in the local `.env` file, which is excluded by `.gitignore`.

If a secret was shared outside the local machine, revoke and replace it before starting the bot:

- In **@BotFather**, use `/revoke` for each exposed bot, then copy the replacement token into `.env`.
- In **Google Cloud Console → IAM & Admin → Service Accounts → Keys**, delete the exposed JSON key and create a replacement JSON key.

The account owner's Gmail address is not used by the application. Only the service-account email needs Sheet access.

1. Create two bots with Telegram's **@BotFather**.
   - `StudioIksha Founder` — speak to Parash privately.
   - `StudioIksha Project` — add this bot to every project group.
2. In Google Cloud, enable **Google Sheets API** and create a service account.
3. Create a blank Google Spreadsheet and share it as **Editor** with the service-account email.
4. Copy `.env.example` to `.env` and add the values. Use `\n` inside `GOOGLE_PRIVATE_KEY`.
5. Run:

   ```sh
   npm run setup-sheet
   npm run seed-workflow
   npm run start:local
   ```

No npm install is required: this starter uses Node's built-in `fetch` and `crypto` APIs.

### Railway deployment

Railway does not use the local `.env` file. Add the same values from `.env.example` in the Railway service's **Variables** screen, then use the default `npm start` command. Keep `.env` only on your local machine.

## Sheet setup after bootstrapping

Add one `Projects` row with a unique `ProjectID`, project name, and the Telegram **group chat ID**. You can get the ID by adding the group bot and sending `/start` in that group; its reply prints the chat ID.

Add rows in `Users` for every operational user:

| TelegramUserID | Name | Role | Active |
| --- | --- | --- | --- |
| 123456789 | Parash | Founder | Yes |
| … | Designer name | Designer | Yes |

### Create the first pilot project

After the group bot has been added to a test Telegram group, send `/start` in the group. Copy the displayed group chat ID, then run:

```sh
npm run create-demo-project -- P001 "Demo House" "Demo Client" 2026-09-20 -1001234567890
```

This creates the `Projects` row and generates a sequential 15-step house-building schedule from `HOUSE-V1`. It intentionally leaves the team assignment blank; enter team members in `Users`, then add their Telegram IDs to the relevant generated task rows.

## Commands

### Founder bot (private)

- `/createproject` — guided project creation: name, client, start date, and project group selection.
- `/projects` — list projects and high-level task counts.
- `/project P001` — view progress and delays for a project.
- `/adduser TELEGRAM_ID | Name | Role` — add or update a team member.
- `/approvals` — list pending delay approvals.
- `/cancel` — cancel a guided flow.

### Project group bot

- `/start` — verify the group mapping and print the group chat ID.
- `/tasks` — list active tasks for this project.
- `/done TASK_ID` — mark an assigned task complete.
- `/delay TASK_ID DAYS reason` — request a delay approval.
- `/issue TASK_ID description` — record a project issue.
- `@Jejdidjududh_bot natural-language update` — turn a plain-language note into a safe action draft; reply to the bot for the same effect.

## Deliberate MVP boundaries

This first cut establishes the two-bot model, permissions, audit trail, and approval loop. It does **not** yet move downstream dates, create Calendar events, or generate rework tasks. Those actions should be implemented after the team verifies that the group interaction is comfortable in a real project.
