> Historical record. Use the current application README and architecture guide for setup and ownership.

# Implementation plan: blank projects, add-a-stage timeline, and the Accept/Reject query flow

Written 16 October 2026, from the founders' demo call and a read of the real code.
Audience: any engineer picking this up cold. Nothing here assumes you were on the call.

How to use this document: read §0–§3 once (about 15 minutes). Then do the work packages (§5) in the order in §6. Every work package lists the exact files, the steps, the tests and the "done" check. If a step contradicts the code you see, trust the code, fix the plan in the same PR, and tell the product owner.

---

## 0. The 60-second version

The founders want three things:

1. **New projects start blank.** No 14-stage default template. They add stages as the project goes.
2. **A stage is a fixed block of 6 tasks that run one after another.** The founder adds a stage with one pop-up (name + a duration for each of the 6 tasks). Stages are collapsed by default and move as a unit. Stages may overlap each other; tasks inside a stage never do.
3. **Client/team queries get exactly two buttons: Accept or Reject.**
   - Reject: a mandatory message, sent to the Telegram group as a reply.
   - Accept: pick a stage (or add a new one) → pick a task → pick an action (Delay N days / Redo / Mark complete) → review an AI-suggested reply → confirm. The query and its photos are attached to that task's thread.

Plus: only the client's messages, or messages tagged `/query` or `/update`, become queries (so team chatter is not spam).

Two repos are involved. The Telegram bot decides dates and writes the Google Sheet. The web app shows them and never calculates dates itself (§2.3).

---

## 1. Requirements (from the call)

Each ID is referenced by the work packages. "Source" is what was said on the call, paraphrased.

| ID | Requirement | Source |
|---|---|---|
| R1 | A project can start **blank**: zero stages, zero tasks, an empty calendar. The existing templates stay available as an option. | "Blank sheet, starting me default nahi chahiye" |
| R2 | A **stage has 6 fixed tasks**, always in the same order, always with the same responsible role. | "Ye 6 consistent hain" |
| R3 | **Add stage** from the timeline by right-click (and a visible button). ONE pop-up: stage name, and a duration dropdown (minimum 1 day) for each of the 6 tasks, and a "side team" person for the execution task. | "Right click, new stage, ek hi pop-up" |
| R4 | Stages are **collapsed by default**. | "Keep this all collapsed" |
| R5 | **Move a whole stage** (all its tasks move together). Stages may overlap other stages. **Tasks within a stage never overlap.** | "Stage move karna hai, tasks nahi" |
| R6 | Any move that collides with other work shows a **preview and asks to confirm** before saving. | Demo section on collisions |
| R7 | A query has only **Accept** and **Reject**. The old "Convert to task" and "Finalize & reply" go away. | "Do hi option, accept ya reject" |
| R8 | **Reject** needs a mandatory message, and that message is **sent to the group** as a reply. | "Reject me message mandatory" |
| R9 | **Accept** flow: stage (existing or new) → task in that stage → action → summary/reply → confirm. Actions are only **Delay (N days)**, **Redo**, **Mark complete**. The query + its media are attached to the task's thread. | "Stage, task, action, teeno hi" |
| R10 | In the stage picker, **ongoing stages come first**. A **completed stage cannot be chosen** for an action: the founder must add a new stage instead. | "Ongoing top pe, scroll na karna pade" / "plumbing khatam ho gaya to add a stage" |
| R11 | Only the **client's messages** or messages that use a **tag** become queries. Two tags: `query` and `update`. The Telegram `/` menu should list them. | "Slash query, slash update" |
| R12 | The **AI-suggested reply** (already built) must also appear in the accept and reject dialogs, and must know what was just done. Replies are never auto-sent. | "Suggest reply sexy hai, accept me bhi chahiye" |
| R13 | **Existing, ongoing projects** must be enterable by hand: a stage that already started, with some tasks already done. | "Kal main apne ongoing projects daalunga" |
| R14 | One person can be both founder and designer, with a **role toggle**. | End of call |
| R15 | Nothing is sent to Telegram automatically. A human confirms every outgoing message. | "Automatically bhejega to damage ho sakta hai" |

### Correction to the earlier summary

Earlier I wrote "show the ongoing stage's queries at the top". That was wrong. What was meant is the **stage picker inside the Accept dialog**: ongoing stages are listed first (R10).

---

## 2. How the system works today (read this before touching code)

### 2.1 Two repos, three working copies

| Name in this doc | Path | Git branch to use | Runs |
|---|---|---|---|
| **BOT** | `/Users/parashrautela/Documents/Telegram bot /.claude/worktrees/timeline-phase-2` | create `feature/stage-query-flow` from `timeline/phase-2` | Node 22, no npm dependencies. Telegram polling + an HTTP "web bridge" |
| **WEB** | `/Users/parashrautela/Documents/Telegram bot /work/production-web` | create `feature/stage-query-flow` from its current head | Node 20+, Vite/React 19. `backend/server.js` serves the API and the built bundle |
| Main checkout | `/Users/parashrautela/Documents/Telegram bot ` on branch `codex/telegram-decision-inbox` | **do not build here** | Stale. It was already merged. It holds uncommitted Phase 1 fixes: do not discard them |

Notes:
- `work/production-web` is its own git repository (remote: `parashrautela/workflow-managment-`). The parent repo only sees it as untracked.
- Baselines I ran on 16 Oct 2026, both green. Run them before you start so you know what "green" looked like:
  - BOT, from its folder: `node --test src/*.test.js` → **41 pass, 0 fail**
  - WEB, from its folder: `node --test backend/*.test.js frontend/src/lib/*.test.js` → **47 pass, 0 fail**
- WEB ships a **committed build**: `frontend/app.js` and `frontend/app.css` are generated by `npm run build` and checked in, and the server serves those files. If you change anything under `frontend/src`, run `npm run build` and commit the output, or nothing changes in production.
- `work/production-web/.agents/rules/backend_lock.md` says "never edit `backend/`". It is a leftover from another machine (`/Users/office/...`). The repo's own history edits `backend/` constantly. **Ignore it, but confirm with the product owner on day 1.**

### 2.2 Data flow

```
Telegram group ──► BOT (src/index.js)  ──writes──► Google Sheet  (Tasks, DecisionRequests, Projects, GroupMembers, AuditLog …)
                      │  ▲
   POST /api/integrations/telegram/requests (queries)       │  │  Bearer INTEGRATION_SHARED_SECRET
                      ▼  │
                   WEB (backend/server.js + backend/tasks/pilot.js) ──► state in Postgres (one JSON blob) or backend/data.json locally
                      ▲
                      │ browser: React app, polls /api/founder/projects/:id/workspace
                   Founder / employee
```

- **Google Sheet is the source of truth for task dates.** Tab `Tasks` has `PlannedStart/End`, `CurrentStart/End`, `ForecastStart/End`, `ActualStart/End`, `Status`, `Stage` (a text label), `Sequence`, `PredecessorTaskIDs` (like `P001-T20:FS,P001-T10:SS`), `AssignedRole/TelegramID/Name`.
- A **stage is not a record**. It is the `Stage` text on a group of task rows. The web app builds its `project.stages[]` from those labels (`backend/tasks/pilot.js` at `workflow/start`, and `backend/tasks/task-sync.js` hydration).
- The web mirrors tasks into its own state (`state.tasks`, `state.projects[].stages`) by calling the bot's `/api/integrations/web/tasks/sync` (`backend/tasks/task-sync.js`).
- Queries ("decision requests") live in the Sheet tab `DecisionRequests` and are mirrored into web `state.decisionRequests`.

### 2.3 Rule that governs the whole design

**The web never computes dates. The bot's engine does.** Memory of a prior decision: "the bot engine computes moves, the web never computes dates itself." The web sends *intent* (which task, which new start/end, or "delay 3 days"), the bot's `rescheduleTasks` (in `src/workflow/engine.js`) validates it, pushes dependents, and writes the Sheet. The web then re-reads.

Already built (Phase 2, on `timeline/phase-2`) and reused by this plan:
- Bot: `POST /api/integrations/web/schedule/preview` and `/apply` (`src/integrations/web-bridge.js`), using `rescheduleTasks`.
- Web: `POST /api/founder/projects/:id/schedule/preview|apply` (`backend/tasks/pilot.js`), `previewSchedule`/`applySchedule` in `frontend/src/lib/api.js`, the drag/resize/swap + confirm dialog in `frontend/src/features/timeline/ProjectTimeline.jsx`, and `moveFor`/`swapMoves`/`undoMoves` in `frontend/src/features/timeline/lib/timelineStatus.js`.

### 2.4 Where each current behaviour lives

| Thing | File (line numbers are approximate; search by name) |
|---|---|
| Query capture: `/approval`, `/question`, and automatic client messages | BOT `src/integrations/decision-requests.js` (`parseDecisionRequest`, `parseClientRequest`), wired in `src/index.js` around lines 978–1010 |
| Query sync to web | BOT `syncDecisionRequest` → WEB `server.js` `POST /api/integrations/telegram/requests` |
| Query actions (approve/reject/convert) | WEB `backend/tasks/pilot.js`, route group `decision-requests/:id/(comment|approve|reject|convert|read)` |
| Publish reply to Telegram | WEB `backend/server.js` (`decision-requests/:id/publish`, ~line 477) → BOT `/api/integrations/web/decisions/publish` |
| AI suggested reply | WEB `backend/queries/reply-suggestions.js`, route `.../suggest-reply` (`server.js` ~line 460), UI `components/SuggestReply.jsx` |
| Query UI | WEB `components/DecisionInbox.jsx` (founder inbox) and `components/ClientQueryCard.jsx` (inside a project; founder and employee) |
| Timeline | WEB `components/ProjectTimeline.jsx` (473 lines), `lib/timeline.js`, `lib/timelineStatus.js`, wrapper `ProjectTimelineWorkspace.jsx` |
| Project start / template picker | WEB `components/WorkflowTemplateModal.jsx` → `startWorkflow` → `pilot.js` `workflow/start`, which calls BOT `/api/integrations/web/projects/start` |
| Template catalogue | BOT `src/workflow/schema.js` `WORKFLOW_OPTIONS`, `src/interior-sheet-plan.js` (the founders' "INTERIOR 1" plan, 68 tasks) |
| Task thread | WEB `components/TaskThreadDrawer.jsx`, `state.taskMessages`, routes `tasks/:id/messages` |

---

## 3. Decisions I made (change them if you disagree) and open questions

Each row has a default so work is never blocked. The "Ask" column says who to confirm with.

| # | Question | Default used in this plan | Ask |
|---|---|---|---|
| D1 | Canonical 6 tasks and roles. | Taken from the founders' own sheet (stages 4 and 5b of `interior-sheet-plan.js`): ① Site Condition Check (Site Supervisor) ② Drawing (Designer) ③ Drawing approval (Design Head/Admin) ④ Client Presentation & approval (Client) ⑤ Site Execution (the trade/side person; varies) ⑥ Final check (Design Head/Admin). | Founders: confirm names and roles |
| D2 | Can a task be "zero days"? On the call they said "min 1" and also "set it to zero". | Dropdown is **1–30 days plus "Skip"**. Skip means the task is **not created** (no phantom completed task). | Founders |
| D3 | Does stage 1 of a new stage start right after the previous stage, or in parallel? | Default **"After {previous stage}"**. Option **"At the same time as {previous stage}"** (starts when that stage's first task starts; same SS link `interior-sheet-plan.js` uses). Option **"Start on a date"**. | Founders |
| D4 | **Redo** means? | Adds the task's **original planned length** again (e.g. planned 5 days → +5), increments `ReworkCycle`. | Founders |
| D5 | **Mark complete** when the work finished *early*? | v1: status becomes Completed, `ActualEnd` = today, **dates of later tasks do not move earlier** (the engine only ever pushes later; see `rescheduleTasks` comment). If it finished *late*, the end moves to today and dependents are pushed. Pulling dependents earlier is a follow-up (WP-X2). The call said "next starts tomorrow"; confirm if that matters. | Founders |
| D6 | Query from a team member that is not a tagged message. | Ignored (as today). Only client messages and `/query`, `/update`, `/approval`, `/question` create requests. | — |
| D7 | What does `/update` do? | Creates a request of type **Update**. It shows in its own "Updates" filter in the inbox. Accepting an Update uses the same wizard plus a 4th action **"Just attach"** (no date change). | Founders |
| D8 | Founder + designer role toggle needs two founder logins. Today there is one shared `FOUNDER_PASSWORD`. | **Deferred** to WP9. Workaround now: create an Employee account for the person who also designs. | Product owner |
| D9 | Stage names must be unique per project (the Sheet identifies a stage only by its text). A repeat like a second "Plumbing" gets blocked with a suggestion ("Plumbing (2)" or "Plumbing – repair"). | As stated | — |
| D10 | The `INTERIOR-SHEET-V1` template stays selectable next to "Blank project". | Yes | Founders |
| D11 | Stage/schedule features only work for projects **linked to a Telegram group** (today's schedule routes already require this). Web-only unlinked projects get a clear message, not support. | As stated | — |
| D12 | Is `timeline/phase-2` already deployed? Its web routes (`schedule/*`) require it. | Unknown. **Check before starting** (§7). | Product owner |

---

## 4. Target design

### 4.1 The canonical stage (shared constant, mirrored on both sides)

```js
// BOT: src/workflow/engine.js   WEB: frontend/src/features/timeline/lib/stageTemplate.js  (identical keys)
export const STAGE_TASKS = [
  { key: 'site-check',   title: 'Site Condition Check',            role: 'Site Supervisor',    audience: 'internal' },
  { key: 'drawing',      title: 'Drawing',                         role: 'Designer',           audience: 'internal' },
  { key: 'approval',     title: 'Drawing approval',                role: 'Design Head/ Admin', audience: 'internal' },
  { key: 'client',       title: 'Client Presentation & approval',  role: 'Client',             audience: 'client'   },
  { key: 'execution',    title: 'Site Execution',                  role: 'Site Team',          audience: 'internal', roleEditable: true },
  { key: 'final-check',  title: 'Final check',                     role: 'Design Head/ Admin', audience: 'internal' },
];
```

A test in the WEB repo must assert its copy has the same keys/titles/roles as a JSON fixture exported by the BOT (§5, WP2 tests). Two copies exist because the repos cannot import each other.

### 4.2 Sheet rows created for a new stage

For a stage named `Flooring` with tasks sequence numbers `S`, `S+10`, …:

| Column | Value |
|---|---|
| `TaskID` | `{ProjectID}-ST{n}-{k}` where `n` = next stage counter for the project (count existing `WEB-STAGE` stages + 1) and `k` = 1..6 by canonical position. Must be unique across the whole sheet; check before writing. |
| `WorkflowID` | `WEB-STAGE` (new). **Not** `WEB-CUSTOM` (that is single custom tasks). |
| `TemplateID` | `WEB-STAGE-{n}-{key}` |
| `Sequence` | max existing Sequence for the project + 10, then +10 each. |
| `Stage` | the stage name exactly as typed (trimmed) |
| `TaskName` | `{Stage name} — {task title}` (always prefixed: unique and readable in `/tasks`) |
| `AssignedRole` | canonical role (or the edited role for Site Execution) |
| `AssignedTelegramID`, `AssignedName` | resolved from `GroupMembers` for this group by matching `AssignedRole` case-insensitively; blank if no unique match (the founder can pick a person in the dialog) |
| `Status` | `Pending` (or `Completed` for tasks the founder marks already done, WP2) |
| `PlannedStart/End`, `ForecastStart/End` | the computed dates. `CurrentStart/End` stay blank (same as `buildScheduledTasks`). |
| `PredecessorTaskIDs` | task 1: link to the previous stage per placement (§4.3). Tasks 2..: `{previous task id}:FS`. |
| `DependencyType` | `FS`/`SS` when a single predecessor, else blank (copy `buildScheduledTasks`) |
| `Audience`, `Phase` (`Site`), `Trade` (= stage name), `TemplateVersion` (`WEB-STAGE-V1`), `ReworkCycle` (`0`), `ApprovalStatus` (`Not Required`) | as in `buildScheduledTasks` |
| `BlockedReason` | `''`, or `Waiting on a predecessor without a confirmed duration` when the anchor has no dates |

### 4.3 Placement rules

A stage spec carries `placement`:

- `{ type: 'after', stageName }` → task 1 gets predecessor `{last task of stageName}:FS`. Default stage = the stage whose tasks end last ("tail"). If the project has no stages, the stage starts on `startDate` (defaults to today).
- `{ type: 'parallel', stageName }` → task 1 gets predecessor `{first task of stageName}:SS`.
- `{ type: 'date', startDate }` → no predecessor; task 1 starts on that date (used for entering ongoing projects).

Dates for task k: `start = max(anchor)` as in `scheduleDefinitions`; `end = start + duration − 1`; next task starts `end + 1`. If a duration is "Skip", that task is not created and the chain links the neighbours (task k+1's predecessor = task k−1).

"Already done" support (R13): `doneCount` (0–6) marks the first N *created* tasks `Completed` with `ActualStart/End` = their computed dates. `startDate` may be in the past.

### 4.4 New and changed HTTP contracts

All bot routes: `POST`, `Authorization: Bearer ${INTEGRATION_SHARED_SECRET}`, JSON, body limit 50 KB (existing `readBody`), responses never include the secret. All web routes: founder session cookie (admin), same `{ error }` shape for failures as the rest of `pilot.js`.

**BOT `POST /api/integrations/web/stages/add`**

```json
{
  "groupChatId": "-100123",
  "mode": "preview",
  "actorName": "Founder",
  "stage": {
    "name": "Flooring",
    "placement": { "type": "after", "stageName": "Civil Work" },
    "doneCount": 0,
    "tasks": [
      { "key": "site-check", "durationDays": 1 },
      { "key": "drawing", "durationDays": 2 },
      { "key": "approval", "durationDays": 1 },
      { "key": "client", "durationDays": 1 },
      { "key": "execution", "durationDays": 5, "role": "Tile person", "assigneeTelegramId": "555", "assigneeName": "Ravi" },
      { "key": "final-check", "durationDays": 2 }
    ]
  }
}
```

`durationDays: 0` or `null` means Skip. Response (preview and apply):

```json
{ "ok": true, "conflicts": [], "warnings": [],
  "stage": { "name": "Flooring", "startDate": "2026-11-02", "endDate": "2026-11-13" },
  "created": [ { "taskId": "P004-ST1-1", "title": "Flooring — Site Condition Check", "start": "2026-11-02", "end": "2026-11-02", "role": "Site Supervisor", "assigneeName": "" } ],
  "finish": "2026-12-20",
  "tasks": [ /* apply only: all project Task rows, same shape as the sync snapshot */ ] }
```

Errors: `400` bad input (name empty/over 60 chars, bad key, duration not an integer 0–365, more than 6 tasks, none left after skips), `404` project/group or `placement.stageName` not found, `409` duplicate stage name (case-insensitive), project closed, another change being saved (the `tasks:<ProjectID>` lock in `startingProjects`), or `placement` anchor has no dates and the caller set `requireDates:true`.

**BOT `POST /api/integrations/web/tasks/action`**

```json
{ "groupChatId": "-100123", "mode": "preview", "actorName": "Founder",
  "taskId": "P004-ST1-2", "action": "delay", "days": 3,
  "fromStart": "2026-11-03", "fromEnd": "2026-11-04", "note": "Query REQ-… accepted" }
```

`action` ∈ `delay | redo | complete`. `days` required (1–60) only for `delay`. `fromStart`/`fromEnd` are the stale-view guard (same as `schedule/*`): if they differ from the Sheet → `409 {"error":"The schedule changed since you opened it. Refresh and try again."}`; this also makes a retry after a lost response safe, because a second apply sees changed dates and refuses instead of double-delaying.
Response is the same shape as `schedule/preview` (`ok, conflicts, warnings, affected, finish`) plus `summary` (one human sentence, e.g. `Delayed "Flooring — Drawing" by 3 days. 4 later tasks moved. Projected finish 20 Dec.`) and, on apply, `tasks`.
Rules: `delay` and `redo` on a Completed/Archived task → `409 "{title} is already completed. Add a new stage instead."`. `complete` runs `completionBlockReason` (existing) and refuses when an earlier task is unfinished.

**WEB `POST /api/founder/projects/:projectId/stages/preview` and `/stages/apply`**: body `{ stage }` as above. Server: project must have `telegramGroupChatId` and `workflowStartedAt` (same 409 message as `schedule/*`), checks all existing tasks are `telegramSyncStatus === 'Synced'`, calls the bot, on apply runs a read-only sync (so the new stage and tasks are hydrated into web state), writes an `audit('stage_added', …)`, saves, and returns `{ ok, conflicts, warnings, stage, created, finish, tasks }`.

**WEB `POST /api/founder/decision-requests/:id/accept-preview` and `/accept`**

```json
{ "target": { "kind": "task", "taskId": "<web task id>", "action": { "type": "delay", "days": 3 } },
  "note": "" }
```
or
```json
{ "target": { "kind": "new-stage", "stage": { /* same as stages/add */ }, "linkTaskKey": "drawing" }, "note": "" }
```
or for Update-type requests only: `"action": { "type": "attach" }`.

Response: `{ ok, request, task, summary, conflicts, warnings, affected, finish, tasks }`. `accept-preview` changes nothing, returns what *would* happen. `accept`:
1. admin only; request must belong to a project of this workspace; closed requests (`Rejected`/`Done`) → `409`; an already accepted request with the same payload returns `200` with the stored result (idempotent), a different payload → `409`.
2. task kind: the task must belong to the project, not deleted, `telegramSyncStatus === 'Synced'`, and not Completed unless the action is `attach`.
3. call the bot (`tasks/action` or `stages/add`); any conflict → `409` with the bot's message and nothing saved locally.
4. read-only sync, then in one in-memory mutation + one `save()`: `request.taskId`, `request.linkedStageId`, `request.decisionStatus = 'Approved'`, `request.status = 'Approved'` (unless already `Published`), `request.acceptedAt`, `request.acceptSummary = summary`, `request.acceptAction = {…}`; append a **query message** to the task thread (§4.5); `audit('query_accepted', …)`.
5. Never publishes to Telegram (R15). The browser then calls the existing `suggest-reply` and `publish` endpoints.

**WEB existing `reject`**: unchanged request shape `{ reason }`; additionally store `request.rejectionReply = reason` and return the request. The browser then calls the existing `publish` endpoint with the same text, after the founder has seen and edited it.

**WEB existing `convert`**: keep the endpoint for backwards compatibility, remove it from the UI.

### 4.5 The query message in a task thread

`state.taskMessages` entries get an optional shape:

```js
{ id, taskId, projectId, authorId: 'system', author: 'Client query',
  text: '<original message>\n\n<context if any>',
  attachmentUrl: '',
  queryId: '<request id>',               // new
  attachments: [{ index: 0, type: 'Photo', fileName: '' }],   // new; served by the existing attachment route
  at: '<iso>' }
```

`attachments[i]` is displayed using the existing `getAttachmentUrl(requestId, index)`. The existing attachment route (`server.js` ~line 363) already allows founder and employee sessions; verify that an employee only sees attachments of requests in their own projects.

### 4.6 State changes in WEB hydration

`backend/tasks/task-sync.js` currently drops an unknown `source.Stage` into `project.stages[0]`. Change it to **create the missing stage** (`id: tg-stage-{project.id}-{n}`, `name`, `order`, `startDate`, `deadline`, `dependencies: []`) and after hydration recompute every stage's `startDate`/`deadline`/`durationDays` from its tasks' effective dates (use the same effective-date order as `timelineItems`: forecast → current → planned). This makes stages added from the web *or* from the Sheet appear correctly.

---

## 5. Work packages

Conventions for every package:
- Work in the repo named. Keep each package as its own commit (message: `WP2: …`).
- Write the failing test first, then the code.
- Add no new npm dependencies.
- Code style: match the surrounding file (BOT uses single quotes and semicolons; `pilot.js` uses a dense one-line style with `fail(...)`; follow it there).
- Never log secrets or full request bodies.

### WP0: Preparation (BOT + WEB, ~30 min)

1. Confirm D12 and the `backend_lock.md` question with the product owner.
2. BOT: `git -C ".claude/worktrees/timeline-phase-2" switch -c feature/stage-query-flow`. WEB: `git -C work/production-web switch -c feature/stage-query-flow`. Do not touch the main checkout.
3. Run both baselines (§2.1). Record the pass counts in the first commit message.
4. Local run for UI work (needs Sheets credentials, so most people will not have them): the bot's tests use an in-memory `store` object (see `src/integrations/web-bridge.test.js`: `rows`, `tasksForProject`, `append`, `appendRows`, `updateRow`, `updateRows`, `audit`, `projectForGroup`). **Create `src/dev-bridge.js`** that builds one such in-memory store seeded with one linked project and calls `startWebBridge`, so the WEB app can be driven locally without Google credentials.
   - Env for BOT: `INTEGRATION_SHARED_SECRET=dev-secret BOT_BRIDGE_PORT=3001`.
   - Env for WEB (`.env`): `FOUNDER_PASSWORD=dev-password INTEGRATION_SHARED_SECRET=dev-secret BOT_BRIDGE_URL=http://localhost:3001`, then `npm run dev` → http://localhost:3000.
   - Seed the in-memory store with a project, a client and two employees so the pages are not empty. Do not commit real IDs.
5. Done when: both baselines are green on the new branches and `dev-bridge` serves `/health`.

### WP1: Blank project (BOT + WEB, ~3 h) → R1

**BOT**
1. `src/workflow/schema.js` → add to `WORKFLOW_OPTIONS`: `{ id: 'BLANK-V1', label: 'Blank project', description: 'Start empty and add stages as the project goes.', parallel: false }`. Check that nothing iterates `WORKFLOW_OPTIONS` expecting template rows (`seed-workflow.js`, `/web/workflows`).
2. `src/integrations/web-bridge.js`:
   - `/api/integrations/web/workflows`: after building `workflows`, **append** `{ id:'BLANK-V1', name:'Blank project', description:…, stages:[], parallel:false }` as the **first** element. (The existing `.filter(workflow => workflow.stages.length)` would drop it otherwise.)
   - `/api/integrations/web/projects/start`: if `option.id === 'BLANK-V1'`: set `Projects.WebManaged='Yes'`, `StartDate`, `Status='Active'`, `TargetEndDate=''`, skip `assignWorkflowToProject` and the `expected.length`/`tasks.length` completeness checks, send the Telegram announcement text *"Project started: {name}. The team will add stages as work is planned."* (reuse `WorkflowAnnouncementStatus` logic), return `tasks: []`.
   - In the same handler, change the "tasks of a different workflow" filter to ignore `WorkflowID` of `WEB-CUSTOM` **and** `WEB-STAGE`: `const planned = tasks.filter(t => !['WEB-CUSTOM','WEB-STAGE'].includes(t.WorkflowID))`. Without this, a second start call on a project that already has stages returns a false 409.
3. Tests (`src/integrations/web-bridge.test.js`): blank start returns `tasks: []` and 200; calling it twice is idempotent; starting INTERIOR-SHEET-V1 on a project that already has `WEB-STAGE` tasks is not blocked by them; `/workflows` lists `BLANK-V1` first.

**WEB**
1. `backend/tasks/pilot.js`:
   - Local `workflows` array: add `{ id:'BLANK-V1', name:'Blank project', stages:[] }` first.
   - `workflow/start` Telegram branch: remove `if (!Array.isArray(result.tasks) || !result.tasks.length) fail(...)` → allow an empty array when `workflowId === 'BLANK-V1'` only (keep the error for other templates). Guard `phase: stages[0].name` → `stages[0]?.name || 'Planning'`. Keep `workflowId`, `workflowName`, `workflowStartedAt`, `startDate`, `status:'Active'`, `stages: []`.
   - Local (unlinked) branch: same `phase` guard.
2. `frontend/src/lib/api.js`: add the blank option to `DEFAULT_PILOT_WORKFLOWS` (first).
3. `components/WorkflowTemplateModal.jsx`: make Blank the **default selection**; for a template with `stages.length === 0` show "No stages yet. You'll add them from the timeline." instead of the stage list; hide the "estimated days" total.
4. `components/ProjectDetailView.jsx` ~line 333 gates the project view on `hasWorkflowStarted`; confirm a blank started project passes it (it has `workflowStartedAt`).
5. Tests: `backend/tests/pilot-integration.test.js` style test: start a linked project with a stubbed bridge returning `tasks: []` for `BLANK-V1` → project has `stages: []`, `phase: 'Planning'`, no tasks; a non-blank template with empty tasks still returns 502.

**Done when:** from the UI you can create a project from a Telegram group, choose "Blank project", and land on an empty project with no errors, and the bot announced it in the group.

### WP2: Add a stage: engine and bot endpoint (BOT, ~6 h) → R2, R3, R13

1. `src/workflow/engine.js`: add `export const STAGE_TASKS` (§4.1) and a pure function:

   ```js
   export function buildStageTasks(existingRows, spec, { projectId, groupMembers = [], today })
   // returns { rows, stage: { name, startDate, endDate }, warnings }
   ```
   Steps inside: normalise/validate `spec` (name 1–60 chars, trimmed; unique among `existingRows.map(r => r.Stage)` case-insensitively, otherwise throw an `Error` with status 409 and message `A stage called "X" already exists. Try "X (2)".`); drop skipped tasks; resolve the anchor from `placement` (§4.3) using each row's effective dates (`ForecastStart || CurrentStart || PlannedStart`, same helper names as in `web-bridge.js`: `effectiveStart/End`); lay out dates; build rows per §4.2; resolve assignees (`spec.tasks[].assigneeTelegramId` wins; else the unique `GroupMembers` match on role; else blank); apply `doneCount`.
   - Reuse `parseDate`, `addDays`, `formatDate` already in this file.
   - Throw (status 400) on: unknown task key, duplicate key, duration not an integer in 0..365, all tasks skipped, `doneCount` > created tasks.
2. `src/integrations/web-bridge.js`: new route `/api/integrations/web/stages/add` (§4.4). Use the same pattern as `schedule/apply`: look up the project by `groupChatId`, take the `tasks:<ProjectID>` lock on apply, load `rows = store.tasksForProject`, call `buildStageTasks`, then:
   - preview: run `rescheduleTasks(rows.concat(newRowsAsTasks), [])` only to compute `finish` via `projectedFinish`; return without writing.
   - apply: `store.appendRows('Tasks', rows)` (one batched call; the file's comment says 68 rows stay inside the Sheets quota), update `Projects.TargetEndDate` if the projected finish changed, `store.audit({ action: 'Stage added', newValue: name, details: 'N tasks, start→end', actor, actorName, source: 'Web timeline' })`.
3. Generate a JSON fixture of `STAGE_TASKS` for the WEB parity test: `src/stage-template.fixture.json`, written by a test (`writeFile` in the test is fine) or checked in and verified by a test that compares it to the constant.
4. Tests, in `src/workflow/engine.test.js` (engine) and `src/integrations/web-bridge.test.js` (route):
   - all 6 durations → contiguous dates, no overlap, `Sequence` strictly increasing by 10;
   - `after` placement: starts the day after the anchor's end; anchor with no dates → rows unscheduled with `BlockedReason`;
   - `parallel` placement: starts the same day as the anchor stage's first task, predecessor type `SS`;
   - `date` placement and a past start date;
   - Skip: skipped task absent, neighbours linked, no `Completed` phantom;
   - `doneCount: 2` → first two rows `Completed` with `ActualStart/End`;
   - duplicate stage name (case-insensitive) → 409; invalid inputs → 400;
   - role→member resolution: unique match fills assignee; two matches leave it blank;
   - route: preview writes nothing (`tasks` store unchanged), apply appends 6 rows, second identical apply → 409 duplicate; Bearer missing → 401;
   - sheet-plan stage names such as `Plumbing Work (6a)` do not break uniqueness checks.
5. **Done when:** `node --test src/*.test.js` is green with the new tests and a manual `curl` against `dev-bridge` adds a stage whose `PredecessorTaskIDs` match §4.2.

### WP3: Stage move and collisions (WEB frontend only, ~3 h) → R5, R6

No new bot code: the existing `schedule/preview|apply` accepts up to 60 moves, and `rescheduleTasks` already (a) refuses a move that starts before a task's predecessor ends and (b) pushes later tasks.

1. `frontend/src/features/timeline/lib/timelineStatus.js`: add

   ```js
   // Every open task of a stage shifts by the same number of days. Completed tasks stay put and are skipped.
   export function stageMoves(items, stageId, shiftDays) -> moves[]
   ```
   Reuse `moveFor(item, shiftDays)` for each non-complete, scheduled item whose `stage.id === stageId`. Return `[]` if any item in the stage is already started and shifting would move it (warn instead: "{n} tasks already started" is shown by the engine's `warnings`, so just pass through).
2. Tests in `frontend/src/features/timeline/lib/timelineStatus.test.js`: shifts +3 and −2, skips completed, skips unscheduled, 60-move cap (stage with >60 tasks cannot occur; assert none), moves carry `fromStart/fromEnd` stale guards.
3. `components/ProjectTimeline.jsx`:
   - The stage summary bar (`.iksha-stage-range`, ~line 362) is a click-to-open button today. Add a **stage drag**: a pointer handler like the task one (`onBarPointerDown` / `updateDrag` / `finishDrag`; read them first, they are around lines 120–300). Generalise the drag state with a `kind: 'task' | 'stage'` field. For `stage`, only `mode: 'move'` exists (no resize, no swap). While dragging, render all that stage's task bars shifted by `drag.shift` (the existing code already shifts a single bar via `shiftStart`; extend it to shift every row whose stage matches).
   - On release call the existing proposal flow with `stageMoves(...)` → `onSchedulePreview` → existing confirm dialog (shows conflicts/affected). A short drag (< 1 day) is a click and still opens stage details.
   - Keep the click-to-open behaviour (`suppressClick` already exists).
   - Accessibility alternative: in `TimelineStageDetails.jsx` add a "Move stage" date input (new start date) + button; it computes `shiftDays` from the stage's current start and goes through the same preview → confirm path. Alt+Arrow on a focused stage bar moves it one day, like tasks.
4. Wording in the confirm dialog (find the existing strings and reuse them): title "Move {stage name}?", body lists "{n} tasks in this stage move together", then the engine's `affected` and `conflicts`. Primary button "Move stage", secondary "Cancel". Conflicts disable the primary button and show the engine's reason verbatim.
5. Behaviour to verify by hand:
   - drag a stage 3 days right → all its tasks shift; later stages that depend on it shift too; stages with no dependency do not;
   - drag a stage earlier than the stage it waits on → dialog shows the conflict and cannot be confirmed;
   - tasks inside the stage never overlap after any operation;
   - Undo (existing `undoMoves`) restores everything.
6. **Done when:** the manual checks pass in the browser at desktop and 375 px width.

### WP4: Task actions (Delay / Redo / Complete): engine and bot endpoint (BOT, ~5 h) → R9

1. `src/workflow/engine.js`: pure function

   ```js
   export function planTaskAction(rows, { taskId, action, days, today })
   // returns { moves, statusChange, summaryParts, error }
   ```
   - find the row by `TaskID` (error if missing or belongs to another project);
   - `delay`: `moves = [{ taskId, start: effectiveStart, end: effectiveEnd + days }]`;
   - `redo`: length = `PlannedEnd − PlannedStart + 1` if both exist else current span; `moves = [{ taskId, start, end: effectiveEnd + length }]`; `statusChange = { ReworkCycle: +1, Status: 'In Progress' if it had started else unchanged }`;
   - `complete`: first `completionBlockReason(row, projectRows)` → if non-empty return it as `error`; `statusChange = { Status: 'Completed', ActualEnd: today, ActualStart: row.ActualStart || min(today, effectiveStart) }`; if `today > effectiveEnd`, also `moves = [{ taskId, start: effectiveStart, end: today }]` so dependents are pushed; if early, no move (D5);
   - Completed/Archived rows with `delay`/`redo` → error (`"{TaskName} is already completed. Add a new stage instead."`);
   - undated tasks (no start/end) with `delay`/`redo` → error `"{TaskName} has no dates yet."`
2. `src/integrations/web-bridge.js`: new route `/api/integrations/web/tasks/action` (§4.4). Flow: lock key `tasks:<ProjectID>` on apply (same `409 Another schedule change is being saved`); stale guard exactly as in `schedule/*`; `planTaskAction`; run `rescheduleTasks(rows, moves)`; on `!result.ok` → 409 with the first conflict reason; preview returns the summary without writing. On apply: **first** `writeSchedule(...)` for the moves, **then** apply `statusChange` with `store.updateRow('Tasks', row.rowNumber, {...})` (`rescheduleTasks` with `enforce` refuses Completed tasks, so the status must be written after the date move). Add `LastUpdatedAt/By`. Audit entry: `action: 'Task delayed' | 'Task redo' | 'Task completed'`, `source: 'Web query'`, `details: note`.
   - Build `summary` with `Intl`-free plain formatting: `Delayed "{title}" by {n} day(s).` / `Sent "{title}" back for rework (+{n} days).` / `Marked "{title}" complete.`; then `{k} later task(s) moved.` if `affected.length - 1 > 0`; then `Projected finish {D Mon}.` if `finish`. Strip the `"{Stage} — "` prefix from titles only for display in the sentence, as `reply-suggestions.js` `spoken()` does.
3. Tests: delay shifts successors; delay on the last task changes `finish`; delay of a mid-chain task leaves independent stages alone; redo adds planned length and bumps `ReworkCycle`; complete late pushes dependents, complete early moves nothing, complete with unfinished predecessor refused; stale guard 409; delay on completed refused; preview writes nothing; double apply with the same `fromStart/fromEnd` → second is 409 (idempotency); unauthorised 401.
4. **Done when:** green tests plus a `curl` preview/apply sequence on `dev-bridge` shows the Sheet rows (in-memory store) changed as expected and an `AuditLog` row was appended.

### WP5: Accept/Reject on the web server (WEB backend, ~6 h) → R7, R8, R9, R10, R12

1. `backend/tasks/pilot.js`:
   - Extend the top route regex with `projects/[^/]+/stages/(?:preview|apply)` and `decision-requests/[^/]+/(?:accept|accept-preview)` (keep the existing alternatives).
   - Implement `stages/preview|apply` per §4.4, modelled line-for-line on `schedule/preview|apply` (same checks, same bot-error mapping: messages matching `/changed since|being saved|cannot|waits for|already exists|completed/i` → 409, else 502). After a successful apply run the read-only sync so hydration (§4.6) builds the stage.
   - Implement `accept-preview` and `accept` per §4.4. Share one internal function `planAccept(state, user, request, input)` that validates and returns the bot call descriptor, so preview and apply cannot drift apart.
   - `accept` must not throw between the bot call succeeding and `save()`. Wrap the local mutation in `try/catch`; if it fails after the bot succeeded, log `accept_local_failed` with request id and return `500 {error: 'The schedule was updated but the query could not be linked. Do not repeat the action; open the timeline to confirm, then link the query from the task.'}`.
   - `reject`: also set `request.rejectionReply = request.reviewNote` and `request.rejectedAt`.
   - Add the thread message (§4.5) via a helper `pushQueryMessage(state, task, request)`.
2. `backend/tasks/task-sync.js`: create missing stages and recompute stage dates (§4.6). Update `backend/tasks/task-sync.test.js` with: unknown `Stage` creates a stage; stage dates equal min/max of task effective dates; an existing stage is untouched.
3. `backend/server.js` `GET decision-requests`: include `linkedTaskId`, `acceptSummary`, `acceptedAt` in what the browser receives (check whether it returns the raw object; if so no change).
4. `backend/queries/reply-suggestions.js`: no change needed (the browser passes the outcome in `instruction`). Add one test that an `instruction` containing a summary reaches the prompt (existing tests show how to stub `fetchImpl`).
5. Tests in `backend/tests/decision-integration.test.js` style (it already stubs the bot bridge): accept task/delay → bot called with the right body, request becomes Approved with `taskId` and `acceptSummary`, a thread message with `queryId` and `attachments` exists, no Telegram `sendMessage` was made; accept preview changes nothing; accept on a Rejected request → 409; same accept twice → second returns stored result; accept with a completed task and `delay` → 409; accept new-stage → stage created and linked; reject stores `rejectionReply`; accept when the bot returns conflicts → 409 and nothing saved; employee session calling accept → 403.
6. **Done when:** `node --test backend/*.test.js` is green and a `curl` walk-through using the cookie from `/api/founder/login` works end to end against `dev-bridge`.

### WP6: Query UI: Accept wizard and Reject dialog (WEB frontend, ~8 h) → R7–R10, R12

New files (put them in `frontend/src/components/`):

- `QueryAcceptWizard.jsx`: props `{ open, onOpenChange, request, project, tasks, stages, onDone }`.
- `QueryRejectDialog.jsx`: props `{ open, onOpenChange, request, onDone }`.
- Shared `lib/stagePicker.js` with `orderStagesForPicker(stages, items, today)` (WP6 step 1).

Steps:
1. `lib/stagePicker.js` + test (`frontend/src/lib/stagePicker.test.js`): returns `[{ stage, group: 'ongoing'|'upcoming'|'completed', selectable }]`. A stage is *ongoing* if it has an open task whose dates include today or that is `In progress`; *upcoming* if all open tasks start after today; *completed* if every task is complete (not selectable, label "Completed. Add a new stage instead"). Order: ongoing (by start), upcoming (by start), completed (by end, most recent first). Tests: two ongoing stages; none ongoing; a stage with no dates goes last among selectable; completed never selectable.
2. `QueryAcceptWizard.jsx`: a `Dialog` with a step indicator. The steps are:
   1. **Where does this go?**: searchable list (type "plum" to filter) built from `orderStagesForPicker`, group headings "In progress today", "Coming up", "Completed". Last row, always visible: **"+ Add a new stage"**. Choosing a completed stage jumps to the new-stage branch with a note "That stage is finished. Add a new stage for this work."
   2. **Which task?** (existing-stage branch): the stage's tasks in order with their role/owner and dates; completed tasks greyed and not selectable (except for Update-type "Just attach"). Pre-select the task that is in progress today, else the first open one.
   3. **What should happen?**: three radio cards: *Delay* (number input 1–60, default 1, plus quick chips +1 +2 +3 +5), *Redo* ("Adds {n} days again"), *Mark complete*. For Update-type requests, a fourth card *Just attach*. As the selection changes, call `acceptDecisionPreview` (debounced 300 ms) and show an inline panel: new dates of this task, "{k} later tasks move", projected finish, and every conflict in red. Conflicts disable Next.
   4. **Reply**: textarea prefilled by `suggestDecisionReply(request.id, instruction)` where `instruction` is built from the preview, e.g. `The founder accepted this. Outcome: Delayed "Drawing" by 3 days; projected finish 20 Dec. Tell the client plainly.` Reuse `SuggestReply.jsx`'s API call; show a "Don't reply" checkbox and keep the AI/fallback label that component already has. Never auto-send.
   5. **Confirm** summary card ("Delay Drawing by 3 days · Send reply to the group") and a primary button **"Confirm and send"** (label **"Confirm"** when "Don't reply" is checked).
   - Branch **new stage**: step 2 becomes the embedded add-stage form (the same component as WP7's `AddStageDialog`, rendered inline: build `AddStageForm` first in WP7 and import it), then step 3 is replaced by "Link this query to which task of the new stage?" (default: first task). No action card.
3. On **Confirm**: (a) `acceptDecision(...)` → on error show the message and stay on the step; (b) if reply wanted, `publishDecisionReply(request.id, { response, idempotencyKey })` using `generateIdempotencyKey()`; if (b) fails show "Task updated, but the reply was not sent: {error}. Retry sending", keep the dialog open on the Reply step with the accept already done (disable earlier steps), and do not call accept again; (c) on full success call `onDone()` which reloads tasks/requests and shows a toast with the summary.
4. `QueryRejectDialog.jsx`: one required textarea "Message to the group" (min 3 chars, max 3,000) with the `SuggestReply` helper and `instruction` = `Politely decline. Reason from the founder: {typed hint}` (a small optional "Reason (internal hint for the AI)" input is fine but optional). Confirm → `rejectDecisionRequest(id, text)` then `publishDecisionReply(id, {response:text, idempotencyKey})`. Same partial-failure handling as above.
5. Replace the old controls in **both** places:
   - `components/DecisionInbox.jsx`: remove the "Convert to Task" button and modal (~lines 339–346, 549–575), the separate approve/reject buttons, and the `mode === 'finalize'` UI; add **Accept** and **Reject** buttons in the request header that open the new dialogs. Keep the private-notes composer (`mode === 'internal'`) and the manual reply composer for edge cases but move it under a "More" menu so Accept/Reject are the visible choices.
   - `components/ClientQueryCard.jsx`: same replacement (its `mode: 'discuss' | 'finalize'` and `convertModalOpen`/`rejectModalOpen` state).
   - Show the result on handled queries: "Accepted → {stage} / {task}: {acceptSummary}" with a link that opens the task thread; "Rejected: {rejectionReply}".
   - Filter chips in the inbox: Open, Handled, Updates (D7). "Open" = no `decisionStatus`; "Handled" = Approved/Rejected/Published/Done.
6. `lib/api.js`: add `acceptDecisionPreview(requestId, body)`, `acceptDecision(requestId, body)`, `addStagePreview(projectId, stage)`, `addStageApply(projectId, stage)` (copy the shape of `previewSchedule`/`applySchedule`).
7. `components/TaskThreadDrawer.jsx`: render messages with `queryId`: a distinct bubble labelled "Client query", the text, and a row of attachment thumbnails/links using `getAttachmentUrl(queryId, index, namespace)`; images inline, other types as file chips.
8. Copy (exact text to use so QA can check):
   - Buttons: **Accept**, **Reject**.
   - Reject dialog title: "Reject this query"; helper: "This message is sent to the group as a reply."
   - Stage step title: "Where does this belong?"; completed-stage note as above.
   - Success toast: the server's `summary`.
9. **Done when:** the manual script in §8 sections B and C passes.

### WP7: Timeline: collapsed default, Add stage, empty state (WEB frontend, ~8 h) → R3, R4, R13

1. **`AddStageForm.jsx` + `AddStageDialog.jsx`** (`components/`):
   - Fields: *Stage name* (required, 1–60, live duplicate check against `stages`; on duplicate show "A stage called X exists. Use 'X (2)'?" with a one-tap fix); *When does it start?* radio (default **After {tail stage}**, or **At the same time as {stage}**, or **On a date**; with no stages: only the date picker, default today); *6 task rows* in canonical order, each with: task title (read-only), role (read-only except Site Execution, which is an editable text with suggestions Tile person / Electrician / Plumber / Carpenter / Painter / Site Team), *person* select (project members whose role matches, plus "Founder", plus "Not assigned"), *duration* native select with options `Skip`, `1 day`, `2 days` … `30 days`, default **1 day** except Site Execution default **3 days** (prefill suggestion only); *This stage has already started* toggle → reveals *Start date* (past allowed) and *Tasks already done* select (0..n).
   - Live summary line under the rows: "Starts {D Mon} · ends {D Mon} · {n} days" computed by calling `addStagePreview` (debounced 300 ms); show conflicts/warnings in red/amber. Never compute these dates in the browser.
   - Buttons: **Add stage** (disabled while preview has conflicts or name invalid), **Cancel**. On success call `onDone(response)`.
   - The duration dropdown must never contain 0. "Skip" is the only way to leave a task out.
2. `components/ProjectTimeline.jsx`:
   - **Collapsed by default:** `collapsed` currently starts as `new Set()` (everything open). Change to an effect that, the first time a given stage id is seen, adds it to `collapsed`; stages the user has toggled keep their state across polls (track `seenStageIds` in a ref). Search still force-expands (`collapsed.has(stage.id) && !query`, already there).
   - **Add stage entry points:** (a) a visible **"+ Add stage"** button in the toolbar next to the zoom controls; (b) a context menu: `onContextMenu` on the timeline background and on stage headings (right-click on desktop, long-press on touch using the existing `LONG_PRESS_MS`), a small popover with one item "Add stage here" (pre-selects placement "After {stage}" for a stage heading, or "On a date" with the clicked date for the background). Do not break the existing `onContextMenu` suppression on task bars (~line 394).
   - Only founders see these (`editable` already means a founder with preview/apply handlers). Employees see the timeline read-only as today.
   - **Empty state:** when `stages.length === 0`: centred card "No stages yet" / "Add the first stage to start planning." with a primary **Add first stage** button; hide the zoom and search rows.
   - After a successful add: reload tasks (`onTasksChanged`, the same callback the schedule apply uses), scroll the new stage into view, expand only that stage for 3 seconds then leave it as the user wants. Simplest acceptable: expand the new stage and scroll to it.
3. `components/ProjectDetailView.jsx` (line ~842 renders `ProjectTimeline`): pass `onAddStage` / reuse the schedule props pattern; thread `members` so the form can offer people.
4. Terminology everywhere on the timeline: **Stage** and **Task** only (the call used these; the audit found "Work item" mixed in).
5. **Done when:** §8 section A passes at 1280 px and 375 px, with an empty project and with a project that has 5+ stages.

### WP8: Query capture rules and Telegram tag menu (BOT, ~3 h) → R11

1. `src/integrations/decision-requests.js` `parseDecisionRequest`: widen the regex from `(approval|question)` to `(approval|question|query|update)`; map `query → RequestType 'Question'` (keep the stored value for compatibility; `RequestID` suffix stays unique per type), `update → RequestType 'Update'`. Keep `/approval` and `/question` working. Unit tests in `src/integrations/decision-requests.test.js`: `/query hello`, `/update@botname`, reply-to-photo with `/update`, `/query` on someone else's photo captures the photo, a plain message from a non-client yields `null`, a plain message from the assigned client still yields an automatic query.
2. `src/integrations/telegram.js`: add `export const setMyCommands = (token, commands, scope) => api(token, 'setMyCommands', { commands, ...(scope ? { scope } : {}) });`.
3. `src/index.js`: after the group bot's `getMe` at startup, call `setMyCommands(config.groupToken, [{command:'query',description:'Ask the studio a question'},{command:'update',description:'Share a progress update'}], { type: 'all_group_chats' })`. Wrap in `try/catch` and log a warning only: a failure must never stop the bot. This is what makes the `/` menu list the two tags in groups (Telegram's built-in command menu).
4. WEB `server.js` `POST /api/integrations/telegram/requests`: accept `RequestType: 'Update'` (check any enum validation) and store it as `requestType: 'Update'`; `components/DecisionInbox.jsx` already shows `requestType`; add the Updates filter in WP6.
5. Spam rule check (R11): confirm in `src/index.js` ~line 1002 that `parseClientRequest` is the only automatic path and requires `project.ClientTelegramID` to match; add a regression test.
6. **Done when:** tests are green and, with the real bot in a test group, typing `/` shows exactly two commands and `/update` with a photo creates an Update row that syncs to the web inbox.

### WP9: Founder + designer role toggle (WEB backend + frontend, ~1–2 days, **deferred**) → R14

Not needed for tomorrow's data entry. Outline so nobody re-discovers the problem:
- Today auth is one shared `FOUNDER_PASSWORD` (`server.js` `/api/founder/login`) and per-person employee accounts (`/api/employee/login`).
- Plan: add a `founders` collection in state (`id`, `name`, `passwordHash`, `employeeId?`). Login by name+password. A founder with an `employeeId` gets a header toggle "View as: Founder | Designer" that calls `POST /api/founder/switch-role` (sets the employee cookie from the linked employee, keeps the founder cookie) and navigates between `/` and `/employee`.
- Until then: create an Employee account for the person who designs, and sign in separately.
- Needs a separate design review for security (session handling, cookie flags). Do not start without sign-off.

### WP10: Existing-project entry polish (WEB frontend, ~2 h) → R13

Mostly covered by the "already started" toggle in WP7. Add: (a) in the empty-state card, a second link "This project is already running: add its current stage", which opens the add-stage dialog with the toggle on; (b) when adding a stage with `doneCount` > 0, the preview shows the done tasks with a tick; (c) a short help text in the dialog: "For a stage that started earlier, set its real start date and how many tasks are already finished."

### WP11: "Start from the default plan" (BOT + WEB, ~5 h), added 16 Oct after founder feedback

The founder can start a project from the default plan (Interior 1) instead of blank, and edit it before anything is created. Blank stays the default.
1. BOT: `GET`-style `POST /api/integrations/web/default-plan` returns the default plan converted to the 6-slot stage format: `[{ name, placement, tasks: [{ key, durationDays }] }]`. Map each Interior 1 task title to a canonical key (`Site Condition Check → site-check`, `Drawing`/`2D drawing`/`3D Design → drawing`, `Design approval`/`Drawing approval → approval`, `Client Presentation & approval → client`, `Site Execution → execution`, `Final check → final-check`). Unmapped canonical slots become Skip (0). Parallel lanes map to `placement: { type: 'parallel', stageName }`.
2. BOT: `POST /api/integrations/web/stages/add-many` takes a list of stage specs and creates them in order, in one batched append, with the same validation as `stages/add`.
3. WEB: the project-start picker offers **Blank project** (default) and **Default plan**. Default plan opens a review list: one row per stage with a checkbox and the 6 duration dropdowns, then **Create plan** calls `stages/add-many`.
4. WEB: in the Add stage form, a **Fill from default plan** dropdown prefills the 6 durations from the matching default stage.

### WP12: Add a task inside a stage (BOT + WEB, ~4 h), added 16 Oct after founder feedback

1. BOT engine: `insertStageTask(rows, { stageName, afterTaskId, title, role, durationDays })` creates one `WEB-STAGE` row, rewires the chain so it sits between `afterTaskId` and its successor in the same stage (`successor.PredecessorTaskIDs` swaps the old link for the new task), then `rescheduleTasks` pushes later work.
2. BOT route: `POST /api/integrations/web/stages/insert-task` with `mode: preview|apply`.
3. WEB: `POST /api/founder/projects/:id/stages/insert-task/(preview|apply)`, and an "Add task after this" item in the task bar's context menu in the timeline, with a small dialog (title, role, person, days) and the usual preview/confirm.

---

## 6. Order of work, dependencies, and what can run in parallel

```
WP0 ──┬─► Track A (BOT):  WP1-bot ─► WP2 ─► WP4 ─► WP8
      │
      ├─► Track B (WEB backend): WP1-web ─► (needs WP2+WP4 contracts, can start with stubs) WP5
      │
      └─► Track C (WEB frontend): WP3 ─► WP7 (needs WP2/WP5 for real data; use dev-bridge) ─► WP6 ─► WP10
WP9 is independent and deferred.
```

Rules for parallel work:
- Tracks A and B/C share the **contracts in §4.4**. Agree them first (this doc is the agreement). If you must change a contract, edit §4.4 in the same PR.
- Never edit the same file from two tracks. File ownership: Track A owns `src/**`; Track B owns `work/production-web/backend/**`; Track C owns `work/production-web/frontend/src/**`.
- Rough size: WP0 0.5 h, WP1 3 h, WP2 6 h, WP3 3 h, WP4 5 h, WP5 6 h, WP6 8 h, WP7 8 h, WP8 3 h, WP10 2 h. About 45 hours in total across the three tracks; one person doing it serially needs roughly 5–6 working days.
- Suggested merge order: WP1 → WP2 → WP4 → WP8 (bot, then deploy the bot) → WP5 → WP3 → WP7 → WP6 → WP10 (web, then deploy the web).

---

## 7. Release and rollback

1. **Before the first deploy**, answer D12. If `timeline/phase-2` is not yet on the hosted bot, deploy it first, or the web's `schedule/*` calls will 404.
2. **Deploy the bot first**, then the web. The new web routes call bot routes that do not exist on an old bot (they return 404, which the web maps to a 502 "Telegram bot unavailable" style error; verify the message is understandable).
3. No Sheet schema migration is needed: the new rows use existing `Tasks` columns, and `WEB-STAGE` is just a new value in `WorkflowID`. Existing projects are untouched.
4. Web release steps: `npm run build` → commit `frontend/app.js`, `frontend/app.css` (and `sw.js` if its cache version needs bumping, so installed PWAs refresh) → deploy.
5. **Rollback:** redeploy the previous web build (the old UI still works against the new bot, because the old routes are unchanged). Rows created as `WEB-STAGE` stay valid Sheet data; the old UI shows them as ordinary tasks under their stage name.
6. Smoke test after deploy (5 minutes): §8 sections A–C on a **test group** with a throw-away project, then archive it.

---

## 8. Manual QA script (run at the end, on desktop 1280 px and phone 375 px)

Use the `dev-bridge` locally first, then a real test Telegram group.

**A. Blank project and stages**
1. Create a project from a Telegram group, choose **Blank project** → empty timeline with the "No stages yet" card. No console errors.
2. Click **Add first stage**. Name "Civil", leave durations → Add. The timeline shows one collapsed stage with 6 tasks of the right roles; dates run end-to-start with no overlap.
3. Right-click the background (long-press on phone) → "Add stage here" → name "Flooring", placement "After Civil" → Add. Starts the day after Civil ends.
4. Add "Electrical" with *At the same time as Flooring* → starts the same day as Flooring's first task.
5. Try adding "civil" again → blocked with the duplicate message. Try Skip on 2 tasks → they are absent.
6. Add a stage with *already started*: start 5 days ago, 3 tasks done → 3 ticked tasks, the rest scheduled.
7. All stages are collapsed after a page reload; expanding one stays expanded across the 8-second refresh.

**B. Moving**
1. Drag the Flooring stage bar +3 days → confirm dialog lists the tasks that move together and anything pushed; Confirm → all 6 tasks moved; Undo restores.
2. Drag a stage earlier than the one before it → conflict message, Confirm disabled.
3. Expand a stage and drag one task: tasks in the stage never overlap after it (conflict or push, never overlap).

**C. Queries**
1. In the test group, as the **client**, send a photo with a message. It appears in the inbox as Open. As a **team member**, send a plain message → nothing appears. As a team member send `/update` + photo → appears under Updates. Typing `/` shows two commands.
2. Open the client query → **Reject** → message required; Confirm → the group receives the reply under the original message; the query shows Rejected with the text.
3. Another query → **Accept** → stage list shows the ongoing stage first, completed stages marked and unselectable → choose ongoing stage → task → **Delay 3** → preview shows new end date and later tasks moved → Reply step shows the AI draft mentioning the delay → Confirm and send. Check: the Sheet row dates changed, the timeline shows it, the task thread contains the query with its photo, the group received the reply, no second message was sent.
4. Accept again on a completed stage's task → refused; choose **+ Add a new stage** instead → form appears inside the wizard → confirm → query linked to the first task of the new stage.
5. Redo and Mark complete on separate queries: redo adds the original length; complete moves the next task to Active status (no date change if early).
6. Double-click Confirm quickly → only one change is applied.
7. Pull the network plug after Accept succeeds but before the reply is sent → UI says the task was updated, reply not sent, offers retry; retry does not re-apply the delay.

---

## 9. Risks and how this plan handles them

| Risk | Handling |
|---|---|
| Stage identity is a text label; renaming or duplicates break links | Uniqueness enforced both sides (D9); no rename feature in this scope |
| Google Sheets quota / partial writes | One batched `appendRows` for 6 rows and one `updateRows` per action; the bot lock `tasks:<ProjectID>` prevents concurrent writes |
| Double-applying a delay on retry | Stale guard `fromStart/fromEnd` makes the second apply a 409 |
| Reply fails after the task changed | Two-step UI with explicit partial-failure state; accept never re-run |
| Old bot + new web | Deploy order §7; web error messages mapped |
| Two copies of the canonical stage | Parity test via JSON fixture (WP2) |
| `WEB-STAGE` rows breaking the "different workflow" check in `/projects/start` | Explicit filter fix in WP1 and a regression test |
| Drag code in `ProjectTimeline.jsx` is dense (473 lines) | WP3 says to read `onBarPointerDown`/`updateDrag`/`finishDrag` first and extend with a `kind` field instead of copying; keep keyboard and swap behaviour untouched; manual QA B3 |
| Committed bundle drift (`app.js`) | WP7/WP6 PRs must include the rebuilt bundle; reviewer runs `npm run build` and checks `git status` is clean |
| Role toggle needs auth redesign | Deferred (WP9) with a workaround |

## 10. Explicitly out of scope

- Renaming or deleting a stage; editing a stage's task durations after creation (use drag/resize).
- Pulling later tasks earlier when work finishes early (follow-up WP-X2; decision D5).
- Per-person or per-trade lanes and double-booking warnings.
- The Hours/day view, virtualization of very large timelines, offline editing.
- Web-only projects not linked to a Telegram group (D11).
- Automatic sending of any message (R15).
- WhatsApp or other chat channels.

## 11. Definition of done for the whole feature

1. Both test suites green, with new tests for every package (BOT ≥ 20 new tests, WEB ≥ 20 new tests).
2. `npm run build` run and output committed on the WEB branch.
3. §8 manual script completed and signed off by the product owner on a real Telegram test group.
4. No console errors and no horizontal page scroll at 375 px on the timeline, add-stage dialog, accept wizard and reject dialog.
5. This document's §3 table has every open question answered or explicitly accepted.
