> Historical record. Use the current application README and architecture guide for setup and ownership.

# Internal project workspace implementation plan

Initial planning draft — 2 October 2026.

Implementation update: the first local slice is now implemented in this checkout.
See [workspace setup and current boundaries](internal-workspace-setup.md). The
separate deployed web app has not been migrated or changed.

## Product direction

The web app is an internal workspace for the founder and employees. Clients communicate through Telegram and have client records, without web login accounts. A project must have an assigned client before the team can select a workflow or start work. Each project has an internal discussion area organized around tasks and tracked queries.

Working assumptions awaiting clarification: founder-only request approval; the target web repository must be confirmed because this checkout contains a standalone frontend prototype and an integration with a separate workflow web app.

## Current implementation and gaps

- `frontend/src/App.tsx` renders hardcoded client conversations. Sending a message changes component state only. There are no persisted threads, real unread counts, authentication, or project authorization in this frontend.
- `src/projects/service.js` creates project shells and generates workflow tasks. Existing onboarding delays plan selection in normal bot flows, but the workflow service itself does not enforce an assigned-client check.
- `src/integrations/web-bridge.js` supports group-member profiles and project creation through authenticated service-to-service endpoints. This shared integration secret is not employee authentication. Its project creation route currently requires a client name, rather than verifying a durable client assignment.
- `src/integrations/decision-requests.js` already captures explicit Telegram `/question` and `/approval` requests, preserves source metadata and attachment references, deduplicates repeat commands, and forwards requests to a web endpoint. Ordinary conversation is not automatically turned into requests. Failed delivery currently requires retrying the command.
- `src/workflow/schema.js` defines projects, workflow tasks, Telegram users, group membership, requests, resources, and audit records. It has no independent staff accounts, web sessions, discussion messages, or read cursors.
- The separate web application's implementation has not been inspected. Its existing persistence and authorization must be checked before deciding what to add or replace.

## Agreed behavior to implement

### Client-first project setup

1. Select or add a client record with a stable client ID and optional Telegram identity.
2. Create the project linked to that client; link its Telegram group when using Telegram intake.
3. Select the workflow template and preview the generated tasks.
4. Add project members and assign task owners.
5. Activate the project and generate its workflow once.

Enforce client assignment and permissions on the server for every entry point, including bot callbacks, web routes, and compatibility helpers. A draft shell, if retained for legacy setup, is inactive and cannot generate work. Employee logins must not depend on Telegram group membership. Template tasks requiring client input remain valid, but their web ownership belongs to an internal coordinator and their client interaction happens through Telegram.

### Employee accounts and project membership

- Each employee has an individual staff ID, login, password, and active account status. Store password hashes; use server-managed authenticated sessions.
- Separate account status from membership: removing someone from one project leaves their other project access intact; disabling an account removes access everywhere and invalidates its sessions.
- Founder: manages clients, projects, templates, memberships, and request review. Assigned employees: access their projects and permitted tasks, resources, and threads. A project-lead reviewer role can be added if confirmed.
- Enforce membership for all reads and writes, including message feeds, notification feeds, search, media previews, and any live subscriptions. Hide controls in the UI as a convenience, not as the access boundary.
- Preserve former employees' authored messages and audit history after revocation. Apply revocation to open sessions and subscriptions.

### Client request to assigned work

`Telegram intake → Pending review → Approve / Reject / Needs clarification → Link to task or create tracked query/task → Assign owner → Resolve`

- MVP intake uses the existing explicit commands and lets the founder/team manually record a client request. Automatic extraction from every Telegram message is later work.
- Preserve client/project identity, original sender, source message reference, text, attachments, and receipt time.
- Pending, rejected, and clarification requests remain reviewer-only. Approval and assignment make the relevant work visible to its owner within the project.
- Approving a request requires choosing an existing task or creating a task/tracked query, with an accountable owner. Questions do not have to become execution tasks.
- Request triage approval is separate from design approval and workflow gates. Approving intake does not complete a task or bypass an existing gate.
- Link request, task/query, and thread through stable IDs. Repeated Telegram delivery or repeated approval must not create duplicate work.
- Resolution remains distinct from approval. Preserve rejection reasons and reviewer actions.
- Telegram replies are explicit, separately authorized outbound actions. Internal thread posts and summaries never automatically publish to clients.

### Task discussions and summaries

- A project Discussions view lists one primary thread per task or tracked query; replies stay inside that thread. Use a small separate Project updates area only for announcements that span tasks.
- Each thread shows its title, owner, status, priority/due date when present, last activity, unread count, and a short summary.
- Thread detail includes the source request if applicable, internal messages, attachment links, and task actions.
- Start with a structured summary: latest decision, blocker, next action, and owner. Keep it editable or derived from explicit task/decision fields.
- Add automatic conversation summarization after the core workflow works. Generated summaries must link back to their supporting messages, show when they were updated, and remain within the thread's access scope. A summary never changes task status or acts as approval.

### Navigation and notifications

- Left: searchable projects the employee can access, with client, project status, and unread indicators.
- Project views: Overview, Tasks, Discussions, Resources, and Team. Reviewers also see Client requests.
- Center: task/thread list with compact summaries; selecting an item opens its discussion and task context. URLs identify project and thread so a refresh or notification deep link reopens the correct place.
- Right: collapsible notification rail for unread messages, mentions, assignments, and approval decisions. On small screens use a drawer.
- Store a per-user read cursor for each thread. Only advance it when that thread's messages are actually viewed; opening a project does not mark every thread read.
- Own messages do not increase unread counts. Compute project message counts from accessible threads. Keep unread message totals distinct from unread notification-event totals.
- Notification clicks open the correct thread; filter all events by current membership and remove access after revocation. Persist counts across refreshes and devices.

### URL-based media

- Persist attachment metadata and references rather than image binaries in the application database.
- Accept approved HTTPS links and retain Telegram file IDs for Telegram-origin assets. Telegram file IDs are not browser-ready URLs.
- Resolve Telegram media through an authorized server endpoint with the bot token kept server-side. Use refreshable URLs or an authenticated preview route instead of saving token-bearing Telegram URLs.
- Handle expired or broken links in the UI. Validate URL schemes; if the server fetches remote previews, restrict its destinations.
- Future web uploads can use external object storage and save references in the database. URL references reduce app storage, but external storage still has a cost.

## Persistence and integration design

Inspect the target web backend first. Reuse its existing account, task, membership, and request entities wherever possible. The required logical entities are:

| Entity | Purpose |
| --- | --- |
| Client | Durable client identity and optional Telegram link |
| Staff account / session | Employee identity, credentials, active state, revocable sessions |
| Project membership | Staff access and role within a particular project |
| Project | Required client link, workflow, lifecycle, Telegram mapping |
| Client request | Source data, triage state, reviewer, linked task/query |
| Task / tracked query | Owner, status, originating request |
| Thread / message | Project-scoped discussions and ordered messages |
| Thread read state | Per-user last-read message position |
| Attachment reference | URL/provider reference and metadata |
| Notification | Recipient, event type, destination, read state |
| Audit event / integration delivery | Decision history and retryable integration work |

If the local prototype is the target, a backend and durable datastore are necessary; frontend state alone cannot meet the requirements. Persistence must support unique constraints, concurrent message writes, and atomic request approval/assignment.

Define one authority for every shared field. Proposed direction: the web backend owns staff access, discussions, read state, notifications, and request triage; preserve the existing bot/Sheets workflow records during the first rollout, linked through stable IDs. Decide task ownership with the actual web repository before introducing task writes. Do not create two independently editable task records without an explicit synchronization contract.

Reuse the current request bridge. Add durable delivery retries, idempotent request intake, stable project/task mappings, and reconciliation for failed sync. Shared-secret endpoints remain backend-only. Internal messages do not enter the outbound Telegram integration.

## Delivery order and acceptance checks

### Phase 0 — Confirm scope and contracts

Identify the target web app, inspect its backend and data model, confirm the reviewer role, and specify entity ownership and request states. Review the proposed project/thread layout before building screens.

Exit: one target repository, a permission matrix, and a clear integration contract.

### Phase 1 — Identity and client-first projects

Implement staff authentication, revocable sessions, project membership, durable client assignment, setup/activation guards, and real project navigation. Move template selection into the internal setup flow while preserving supported bot compatibility.

Exit: no workflow starts without a linked client; unrelated projects are inaccessible; removing membership and disabling an account revoke access appropriately; repeated activation does not duplicate tasks.

### Phase 2 — Request review and assignment

Build the reviewer inbox using existing Telegram intake. Support approve/reject/clarification, task linking or creation, owner assignment, and audit records. Add reliable integration retries.

Exit: pending requests are reviewer-only; approved work reaches its owner once; repeated delivery and concurrent approval do not duplicate work; failed sync is visible and retryable.

### Phase 3 — Persisted task discussions

Convert the client-chat prototype or existing conversation section into project task threads. Add durable messages, source context, link-based attachments, and structured TLDRs. Use existing live-update infrastructure if available, otherwise begin with bounded polling.

Exit: messages survive refresh, stay within their task/project, obey membership permissions, and never automatically reach Telegram. Authorized attachment previews work without exposing bot credentials.

### Phase 4 — Unread state and notifications

Add read cursors, mentions/assignment events, project badges, and the right-side notification rail with deep links and mobile behavior.

Exit: two employees have independent unread counts; only viewed threads become read; own messages do not inflate counts; revoked users receive no new project data.

### Phase 5 — Migration and pilot

Retain historic client conversations as read-only external-source history or link selected messages to requests. Do not relabel client-authored history as internal team discussion. Mark projects missing clients as needing setup without deleting work. Keep existing task IDs and workflow gates.

Pilot one project with founder and designer accounts, verify request-to-resolution flow and revocation, then expand. Add AI summaries and automatic client-request detection only after this pilot.

Exit: existing project history is preserved; one real project completes the full flow; authorization, unread-state, retry, and migration checks pass.

## First implementation slice

One client, one project, founder and designer logins, one Telegram request, one founder approval, one assigned task/thread, one persisted internal reply, and one accurate unread notification. Include client activation guards and access revocation in this slice. Expand templates, team tools, and summary automation after it works end to end.
