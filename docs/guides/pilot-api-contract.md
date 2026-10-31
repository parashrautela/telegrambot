# V1 API contract

## Telegram decision requests

Set the same `INTEGRATION_SHARED_SECRET` in both services. In the Telegram bot,
set `WEB_APP_URL` to this web app's HTTPS origin. In this web app, set
`GROUP_BOT_TOKEN` to the project group bot's token for publishing and attachment
preview, and `BOT_BRIDGE_URL` to the Telegram bot service's HTTPS origin. New
projects can be linked from **Group setup**; existing projects can be linked by
Telegram group chat ID on the founder's **Needs attention** screen. The Telegram
bot's `/start` response shows the ID.

## Telegram group setup

The bot sends authenticated `POST /api/integrations/telegram/groups/snapshot`
with `{ "groups": [{ "groupChatId", "title", "status", "members": [...] }] }`.
Each member has `telegramUserId`, `telegramName`, `membershipStatus`,
`assignedName`, and `assignedRole`. Snapshots update the founder's group roster.
The first snapshot for an unlinked group also creates one web project named after
the Telegram group with `telegramSetupPending: true` and status `Needs setup`.
Repeated snapshots do not create duplicate projects.

These routes require the founder session:

- `GET /api/founder/telegram-groups` lists discovered groups and members.
- `POST /api/founder/telegram-groups/:groupId/members/:userId` accepts
  `{ "name": "...", "role": "..." }`, updates the bot's Google Sheet roster, and
  has the bot announce the assignment in Telegram.
- `POST /api/founder/telegram-groups/:groupId/create-project` accepts
  `{ "projectName": "...", "startDate": "YYYY-MM-DD" }`. A Client role must
  already be assigned. It finishes the pending web project and creates a linked
  shell in the bot service; the bot's existing workflow-plan selection then
  generates tasks.

The bot bridge uses `Authorization: Bearer <INTEGRATION_SHARED_SECRET>` and
exposes `POST /api/integrations/web/group-members` and
`POST /api/integrations/web/projects`. Set `BOT_BRIDGE_PORT` on the bot if it
cannot use the hosting platform's `PORT`.

The bot sends `POST /api/integrations/telegram/requests` with
`Authorization: Bearer <INTEGRATION_SHARED_SECRET>`. The payload uses the
`DecisionRequests` Sheet fields plus `TelegramProjectID`. Requests are
deduplicated by `RequestID` and linked by `GroupChatID`; an unlinked group
returns `409` so the bot can tell the user to retry after linking.

The founder session protects `GET /api/founder/decision-requests`,
`GET /api/founder/decision-requests/:id/attachments/:index`, and
`POST /api/founder/decision-requests/:id/{comment,publish,resolve}`.
Publish sends a reply to the original Telegram message and updates the request
only if Telegram accepts the message. `Published` remains open until a founder
marks the work `Done`. Internal comments never go to Telegram.

Base URL is the same origin that serves the web app. All request and response bodies use JSON. The browser should send requests with same-origin credentials enabled so the session cookies are included.

## Founder session

The founder signs in with the password configured in `FOUNDER_PASSWORD`. The server sets an HTTP-only, SameSite=Strict cookie that expires after eight hours. In production, the cookie is also Secure and the app must use HTTPS. Founder routes return `401` when the session is missing or expired.

### `POST /api/founder/login`

Request:

```json
{ "password": "..." }
```

Success: `200 { "ok": true }` plus the founder session cookie. Wrong password: `401`. Too many attempts from one IP: `429`.

### `POST /api/founder/logout`

Invalidates the current founder session and clears its cookie. Returns `200 { "ok": true }`.

## Founder project operations

All routes below require the founder session.

### `GET /api/founder/projects`

Returns `{ "projects": [...] }`. Each project includes `id`, `name`, `clientName`, `location`, `startDate`, `internalOwnerMemberId`, `internalOwner`, `phase`, `status`, `recentTask`, `nextMilestone`, `blocker`, `members`, `createdAt`, and `completedAt`.

### `POST /api/founder/projects`

Creates a project group. Required: `name`, `clientName`. Optional: `location`, `startDate` (`YYYY-MM-DD`), `phase`, `status`, `recentTask`, `nextMilestone`. The founder assigns an internal owner after adding project members.

```json
{
  "name": "Kumar Residence",
  "clientName": "Asha Kumar",
  "location": "Pune",
  "startDate": "2026-10-01",
  "phase": "Design",
  "status": "Setup",
  "recentTask": "",
  "nextMilestone": ""
}
```

Success: `201 { "project": ... }`. Missing required fields: `400`.

### `PATCH /api/founder/projects/:projectId`

Updates the client-facing project facts (`phase`, `status`, `recentTask`, `nextMilestone`, `blocker`), project `startDate`, and `internalOwnerMemberId`. Only supplied fields are changed. `startDate` must use `YYYY-MM-DD`; `internalOwnerMemberId` must belong to an internal member of the same project (or be an empty string to clear it). Each changed field is included in the project-update audit detail. Success: `200 { "project": ... }`.

### `GET /api/founder/projects/:projectId/updates`

Returns up to the latest 50 saved project updates, newest first. Updates are created when a PATCH changes one or more project fields; a no-op PATCH does not create an entry. Each item includes `id`, `projectId`, `actor`, `changes` (field names mapped to `{ old, new }`), and `at` (ISO timestamp). Success: `{ "updates": [...] }`. Missing project: `404`. Existing projects begin with an empty update history; new changes are recorded from deployment onward.

### `POST /api/founder/projects/:projectId/members`

Adds a project member. All fields are required: `name`, `designation`, and `role`.

```json
{ "name": "Rohan Mehta", "designation": "Interior designer", "role": "Designer" }
```

Success: `201 { "member": { "id", "name", "designation", "role" } }`.

### `POST /api/founder/projects/:projectId/invite`

Replaces any existing client invite for this project and revokes the previous client session. Success: `201 { "link": "https://.../c/<token>" }`. The cleartext token is returned once; only its hash is stored. Production link generation requires `PUBLIC_URL` set to the HTTPS app origin.

### `GET /api/founder/projects/:projectId/conversation`

Returns the latest 30 client question-and-answer pairs, newest first:

```json
{ "messages": [{ "projectId": "...", "question": "...", "answer": "...", "at": "..." }] }
```

### `GET /api/founder/activity`

Returns the latest 40 basic audit events: `{ "activity": [...] }`.

## Employees, team chat, and founder assistant

The founder creates an employee account with `POST /api/founder/employees` using `name`, `designation`, optional `email` and `phone`, `role`, and `projectId`. The response includes a login link, employee ID, and generated password. The password is returned once and only a salted hash is saved. `GET /api/founder/employees` returns employee profiles and active project IDs, without passwords.

To add the same person to another project, send `{ "employeeId": "EMP-...", "role": "Designer" }` to `POST /api/founder/projects/:projectId/employees`. The employee keeps the same login details.

Employees sign in with `POST /api/employee/login` using `{ "employeeId", "password" }` and sign out with `POST /api/employee/logout`. The employee session uses a seven-day HTTP-only cookie. `GET /api/employee/me` returns only their profile and currently assigned projects. Employees cannot edit project facts. They can read and send messages in an assigned project's group chat through `GET` and `POST /api/employee/projects/:projectId/team-chat`, where POST accepts `{ "message": "..." }`. The founder uses `GET` and `POST /api/founder/projects/:projectId/team-chat` for the same conversation. The team chat is separate from the client Q&A.

`GET /api/founder/assistant` returns recent founder chat history. `POST /api/founder/assistant` accepts `{ "question": "..." }` and answers from the workspace's saved project facts. This assistant runs locally on the server and does not send founder records to an external model.

The founder can finish a project with `POST /api/founder/projects/:projectId/complete`. `POST /api/founder/projects/:projectId/trash` removes it from active workspaces while preserving its records. `GET /api/founder/trash` lists those projects, and `POST /api/founder/trash/:projectId/restore` restores one. Client and employee project access is unavailable while a project is in Trash.

## Client link and assistant

The client does not create an account or enter an email. Opening `/c/:token` claims the invite in that browser and sets an HTTP-only, SameSite=Strict cookie that lasts 30 days. The first browser to claim the invite wins. A second browser gets `410`; the founder must create a replacement link if the wrong person claimed it. The mechanism guarantees one claimant, but cannot verify the claimant’s real-world identity.

### `POST /api/client/claim`

Request: `{ "token": "<token from path>" }`.

Success: `200 { "project": { "name", "clientName", "phase", "status", "recentTask", "nextMilestone", "blocker" } }` plus the client session cookie. Invalid or replaced invite: `404`. Already claimed by another browser: `410`.

### `GET /api/client/project`

Returns the same client-safe project snapshot for an active client session. It does not return the team roster or internal project identifiers.

### `GET /api/client/conversation`

Returns up to the latest 30 question-and-answer pairs for this client session’s project. This is the client’s own transcript; the founder can also see it in the founder project view.

### `POST /api/client/chat`

Request: `{ "question": "How is the project going?" }`. Questions must contain 1–1,000 characters. Success: `{ "answer": "..." }`. A session is limited to 30 questions per hour per running server process. The conversation is stored and visible to the founder. Without `OPENAI_API_KEY`, a fact-based fallback answers common project questions. With the key, the server calls the OpenAI Responses API using `OPENAI_MODEL` and `store: false`; it sends the project snapshot and question only.

## Common errors

Errors use `{ "error": "Human-readable message" }`. Relevant status codes are `400` invalid input, `401` missing/invalid session, `404` missing project or invalid invite, `410` invite already claimed by another browser, and `429` rate limit.

## Current storage and runtime notes

Production stores app state in PostgreSQL through `DATABASE_URL`. Local development can use `backend/data.json`. Session identifiers and invite tokens are hashed before storage. Employee passwords use salted scrypt hashes. Client sessions are browser-bound, so opening the invite later in another browser requires the founder to issue a replacement link.

## Pilot backend additions (6 October 2026)

These routes use the existing staff cookies and `{ "error": "..." }` failures.
IDs are opaque strings; timestamps use UTC ISO 8601; dates use `YYYY-MM-DD`.
Clients stay in Telegram. Only founders can manage assignments and publish.
The existing JSON/PostgreSQL state is extended additively; legacy projects and
sessions remain readable. Run one web service replica: this state store has a
single application writer. Production PostgreSQL verification is still required.

### Setup and workflow

- `POST /api/founder/projects`: `name` required, `clientName` optional. New
  projects start in `Setup`; creating active work directly is rejected.
- `POST /api/founder/projects/:id/client`:
  `{ "clientName": "Maya", "clientTelegramId": "42" }`. Telegram ID is optional
  for internal setup, required to identify automatic client intake unless the
  group's active Client roster provides it. Replacement locks after workflow start.
- `GET /api/{founder|employee}/workflows`: `{ workflows: [...] }`, with stage
  previews. Initial templates are `PILOT-DESIGN-V1` and `PILOT-PAINTING-V1`.
- `POST /api/founder/projects/:id/workflow/start`:
  `{ "workflowId": "PILOT-DESIGN-V1", "startDate": "2026-10-07",
"assigneeId": "EMP-..." }`. Requires a client, generates stages/tasks/deadlines,
  and returns `{ project }`. Repeating the same workflow is idempotent; switching
  it returns `409`. Omit assignee to assign the founder.
- `GET /api/{founder|employee}/projects/:id/workspace`:
  `{ project, tasks, requests }`. Membership protects employee access.
- Project responses add `workflowId`, `workflowStartedAt`, `stages`, `progress`,
  `currentStage`, `deadline`, `upcomingDeadlines`, `taskCount`, `openQueryCount`,
  and `clientTelegramId`. Existing response fields remain available.

These pilot templates create internal web coordination tasks. They do not
replace or synchronize the separate Sheets/bot operational workflow. Complete
bot Client-role assignment and its existing workflow-plan picker too, so the bot
stores the explicitly approved `ClientTelegramID` needed for ordinary-message intake.

### Tasks and threads

- `GET /api/{founder|employee}/projects/:id/tasks`: `{ tasks }`.
- `POST /api/founder/projects/:id/tasks`: accepts `title`, optional `description`,
  `assigneeId` (employee ID, `founder`, or empty), `deadline`, `stageId`, `status`.
  Workflow must be started. Returns `201 { task }`.
- `GET /api/{founder|employee}/tasks/:id`: `{ task }`.
- `PATCH /api/{founder|employee}/tasks/:id`: partial updates of the same fields.
  Founder or current assignee may update; only founder may change assignee.
- `DELETE /api/founder/tasks/:id`: soft deletion, preserving query/history links.
- `GET /api/{founder|employee}/tasks/:id/messages?after=<message-id>&limit=100`:
  `{ messages, pagination: { hasMore, nextCursor } }`. Omit `after` for the first
  page. IDs are opaque; `limit` is 1–100. GET has no read side effects.
- `POST /api/{founder|employee}/tasks/:id/messages`:
  `{ "text": "Site check booked", "attachmentUrl": "https://..." }`.
  Attachments are HTTPS references. Returns `201 { message }`.
- `POST /api/{founder|employee}/tasks/:id/read`:
  `{ "lastMessageId": "..." }`. Persistent per-user monotonic read cursor.
  Notification aggregation is deferred; storing this cursor does not implement
  a complete notification inbox.

Task statuses: `Open`, `In progress`, `Blocked`, `Completed`, `Cancelled`.
Completed/cancelled threads must be reopened before new messages. A task has
`sourceQueryId` when converted from a client query.

### Client query discussion and decisions

- `GET /api/employee/decision-requests`: assigned-project requests only.
- `GET /api/{founder|employee}/decision-requests/:id`: `{ request }` including
  internal `comments`, attachment metadata, source IDs, decision/delivery fields.
- `POST /api/{founder|employee}/decision-requests/:id/comment`: `{ "text": "..." }`.
- `POST /api/founder/decision-requests/:id/approve`: `{}`.
- `POST /api/founder/decision-requests/:id/reject`: `{ "reason": "Outside scope" }`.
- `POST /api/founder/decision-requests/:id/convert`: task fields. Returns
  `{ request, task }`. Retrying returns the same linked task and keeps discussion.
  Rejected/Done requests cannot be converted; workflow must be started.
- `GET /api/{founder|employee}/decision-requests/:id/attachments/:index`:
  authenticated Telegram media content. Use this route as an image URL with the
  same-origin cookie. Non-image content downloads. No raw media is stored in
  the core database; the bot token never appears in a client URL. The bounded
  proxy fetches fresh Telegram file paths and supports up to 20 MB. Independent
  cloud archival of Telegram media is deferred.

Approve, reject, convert, and internal comments never send messages externally.
Retain the existing explicit Publish confirmation in the UI. Publish remains
`POST /api/founder/decision-requests/:id/publish` with
`{ "response": "Final reply", "idempotencyKey": "unique-reply-key" }`.
The key is optional for compatibility but new consumers should always supply it.
Identical completed key/body retries return the saved result; legacy keyless
repeats still return `409`. `deliveryStatus` is `Sending`, `Sent`, `Failed`, or
`Unknown`. `Failed` means an explicit Telegram rejection and may be retried.
`Unknown` means timeout, invalid response, or interruption: check the Telegram
group manually, and do not offer automatic retry. No reconciliation UI/API for
Unknown is included yet. Telegram does not provide exactly-once send semantics.
One successful final reply is allowed per query. Decision status is separate
from delivery; publishing does not complete a task.

### Access revocation

- `DELETE /api/founder/projects/:id/members/:memberId` removes project access and
  clears that employee's task assignments in this project. Other projects stay
  available; authored history remains.
- `POST /api/founder/employees/:employeeId/disable` ends all employee sessions,
  blocks future login/assignment, and clears task ownership. Employee responses
  add `active`. Drive permission synchronization remains deferred.

### Automatic Telegram intake and deployment

The Telegram repository keeps its existing single polling worker. It captures
ordinary text/media from the approved assigned client as `Question` requests,
using the existing authenticated integration endpoint. There is no new webhook
or second polling instance. `/question` and `/approval` still work.
`AutomaticClientQuery: true` additionally verifies the sender against the web
client/group roster. Group and bot-project mappings must match. Persisted Sheet
requests retry web sync each minute until acknowledged; duplicate deliveries do
not create duplicate queries. New Sheet columns are additive.

Before pilot: merge both reviewed changes, verify `WEB_APP_URL` on the bot,
`BOT_BRIDGE_URL` and `GROUP_BOT_TOKEN` on the web service, matching
`INTEGRATION_SHARED_SECRET`, and `PUBLIC_URL` set to the exact HTTPS web origin.
Use a single instance of each service and preserve the production database.
Existing UI APIs remain; the frontend developer must connect the new task,
workflow, employee-query, and revocation controls. New projects cannot bypass
workflow setup with a status PATCH. Existing legacy active projects remain editable.

Offline acceptance (mocked Telegram, isolated JSON databases):

```sh
node --test backend/tests/decision-integration.test.js backend/tests/pilot-integration.test.js backend/integrations/telegram-media.test.js
```

Optional isolated sample data, without touching the normal file or PostgreSQL:

```sh
node scripts/seed-pilot.js /tmp/iksha-pilot-demo.json
# Configure GOOGLE_CLIENT_ID and INITIAL_FOUNDER_EMAIL, unset DATABASE_URL, then:
APP_DATA_FILE=/tmp/iksha-pilot-demo.json node backend/server.js
```

Seed refuses to overwrite existing data. It creates data only; Google sign-in
and staff admission still use the normal authentication flow. It creates a sample project/client and two employees; available
workflow templates are served by the API. Complete a live two-service Telegram
text/photo/reply check after deployment: offline tests do not prove live bot
permissions, environment variables, PostgreSQL connectivity, or UI integration.
