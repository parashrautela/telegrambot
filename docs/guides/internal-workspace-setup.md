# Internal workspace: first implementation

This checkout's frontend is now an internal staff workspace. It uses a separate
Node HTTP service and SQLite database. The existing Telegram bot service and its
Google Sheets workflow are preserved. Nothing is deployed by running the checks.

## What works

- Individual staff IDs and passwords, password hashes, 12-hour cookie sessions,
  logout, account disablement, and immediate server-side access revocation.
- A required client record before project creation. Workflow selection happens
  after the client is assigned; repeated activation does not duplicate tasks.
- Project memberships independent of Telegram group membership.
- Founder-only request review: approve and assign, reject, or request clarification.
  An approved question can become a tracked query or link to an existing task.
- Persistent internal task threads, manually maintained decision/blocker/next-action
  TLDRs, resolution and reopening, and HTTPS attachment references.
- Per-user, per-thread unread cursors, assignment and message alerts, project
  counts, and a right-hand notification rail (drawer on smaller screens).
- Telegram `/question` and `/approval` intake through the existing integration
  payload and secret, with project/group mapping and deduplication.
- Server-side guards now prevent bot workflow generation without an active,
  approved client. Inactive shells can still wait for onboarding. The bot stores
  the assigned client's Telegram ID after workflow selection.

## Isolated preview

Use Node 22.13 or newer. Node 22 reports an experimental warning for its built-in
SQLite module; no additional database package is needed.

```sh
npm run frontend:build
npm run workspace:demo
```

Open `http://127.0.0.1:3002`. The command prints a random temporary password for
the sample staff IDs `founder`, `neha`, and `aarav`, plus a direct discussion link.
Each invocation creates an isolated database in the operating system's temporary
directory. Demo credentials never apply to the normal workspace. The script does
not read `.env`, contact Telegram/Sheets, or start bot polling.

Sample workflow: sign in as founder, open Parash ka Ghar → Client requests,
approve the pending pendant request with Neha as owner, and post an internal
message. Sign out and sign in as Neha to inspect the assignment and unread counts.
Opening a thread at its latest messages marks those messages and their alerts
read. Opening a project does not mark all its threads read.

## Persistent local workspace

Set these in your local, ignored `.env` before the first start. Choose your own
founder password; there is no built-in production password.

```dotenv
WORKSPACE_FOUNDER_ID=your-staff-id
WORKSPACE_FOUNDER_NAME=Your Name
WORKSPACE_FOUNDER_PASSWORD=choose-a-unique-password-of-at-least-12-characters
WORKSPACE_DB_PATH=data/workspace.sqlite
WORKSPACE_HOST=127.0.0.1
WORKSPACE_PORT=3002
```

```sh
npm run workspace
```

For source development, run `npm run frontend` in a second terminal. Vite proxies
`/api` to `127.0.0.1:3002`; backend changes require a restart. For a built preview,
run `npm run frontend:build` and open the backend URL directly.

Bootstrap runs only when the database has no staff accounts. Changing bootstrap
variables later does not overwrite passwords. Once initialized, the founder
password variable can be removed from `.env`. Password recovery/rotation is not
yet implemented in the UI.

Create client → create project → add staff membership from Team → choose a
workflow from Overview → assign tasks or review client requests. Removing an
employee from a project leaves other memberships intact and makes their tasks
unassigned. Disabling an account ends its sessions and makes its tasks unassigned;
authored messages remain available to the authorized team.

## Telegram intake

The project creation form has an optional Telegram section. Supply both the
existing bot project ID (for example `P001`) and the numeric group chat ID. Both
must match incoming requests. One group/bot project can map to one workspace
project.

The workspace accepts `POST /api/integrations/telegram/requests` with the payload
already sent by `src/integrations/decision-requests.js`. Configure `INTEGRATION_SHARED_SECRET`
on both services and point the bot's `WEB_APP_URL` to this workspace's HTTPS
origin when ready to connect it. The secret is a backend credential, never a
staff login credential. Keep the bot's existing single polling instance.

Telegram attachment file IDs, names, source message IDs, original sender and
requesting-member metadata are retained. Telegram media preview/download is not
implemented yet: those attachments appear as references. HTTPS links can be
opened directly. Internal messages never automatically post to Telegram.

## Data ownership and current limits

This is the first working slice, not a migration of the separate deployed workflow
web app. SQLite owns this workspace's clients, staff, memberships, internal tasks,
threads, request triage, notifications, and audits. Google Sheets remains the
authority for the existing bot's operational schedules, tasks, and approval gates.
Selecting a template here generates an internal coordination checklist; it does
not create or update bot schedule tasks or enforce bot design/dependency gates.
Do not treat the two task sets as synchronized operational records.

Remaining work: reconcile these models with the target deployed web repository,
import/link existing task history, implement durable bot-delivery retries,
authenticated Telegram media previews, employee password management/reactivation,
mentions, automatic TLDR generation, and richer pagination/live updates. Current
UI updates poll every eight seconds while visible. The founder can manually
record requests; arbitrary Telegram conversation is not automatically classified.

The workspace service defaults to loopback. For deployment, use an HTTPS origin,
set `WORKSPACE_ORIGIN` to that exact origin and `WORKSPACE_SECURE_COOKIES=true`,
bind `WORKSPACE_HOST=0.0.0.0`, and explicitly choose `WORKSPACE_PORT`. Use one
service replica and a persistent volume for `WORKSPACE_DB_PATH`; ephemeral
container storage will not preserve accounts or messages. Back up the SQLite
database and its WAL consistently. Production deployment and migration have not
been performed.

## Verification

The staff interface now shares the Iksha preview's palette, typography, project
summary cards, and navigation across Timeline, Overview, Discussions, Tasks,
Client requests, Resources, Team, sign-in, and management dialogs. Timeline
stages use stable task creation order rather than discussion activity order.

Owners and the founder can schedule work through a task's timeline dialog or
drag and resize scheduled blocks. Dates are stored in UTC and displayed in the
browser's local time; blocks use elapsed time, including nights and weekends.
Schedules are persisted in the workspace database using additive migrations.
Existing work starts unscheduled. Clearing a schedule preserves the task and
its discussion. This does not modify the Google Sheets task schedule or
automatically approve design milestones or move dependent tasks.

For a local walkthrough, build the frontend and run `npm run workspace:demo`.
The printed timeline URL opens a sample residence with overlapping civil and
electrical work. The demo uses a temporary database and temporary staff
credentials and does not start Telegram polling or read production settings.

```sh
npm run check
npm run test:requests
npm run test:workspace
npm run frontend:build
```

Tests cover bot/client activation guards, staff authentication, membership and
account revocation, pending-request privacy, duplicate intake/approval, task/query
linking and resolution, independent unread state, safe URL schemes, persisted
messages and sessions, and HTTP session/origin/integration checks.
