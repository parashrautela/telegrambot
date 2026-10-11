# Studio Iksha founder workspace — master implementation plan

Date: 11 October 2026  
Status: implementation specification and phased delivery plan; application code is not changed by this document.  
Scope: founder workspace, internal team operations, Telegram participation, approvals, documents, scheduling, context recovery, and constrained AI assistance.

## 1. Outcome

Build a workspace in which the founders can return after a weekend, understand every active project, see what needs their involvement, and act without reconstructing Telegram conversations.

The agency handles end-to-end architectural, interior, construction, contractor coordination, and supervision work. A house is a project. Design, measurements, procurement, carpentry, plumbing, and other deliverables are work within that project.

The interface must stay simple. Scheduling rules, message routing, dependency checks, file versioning, notification aggregation, and delivery retries belong behind the screen. Founders see the result and the action they can take.

The first real proof is the carpenter journey:

1. Assign work with the right drawing and instructions.
2. Receive the carpenter's Telegram question in the founder intervention queue.
3. Open Backtrack and recover the assignment and relevant discussion.
4. Respond from the workspace to the original Telegram conversation.
5. Receive completion photos.
6. Approve the work or request correction.
7. Update the dependent work and project context automatically.

## 2. Product decisions established in the conversation

| Area | Decision |
| --- | --- |
| Founder access | Gosik and Nishank use one shared founder account. |
| Intervention ownership | Either handles a request; buttons assign responsibility to Gosik or Nishank. |
| Primary alert | Top badge uses the requested label, “Instant interference from the founders.” |
| Alert behavior | Badge opens a persistent queue/detail panel; no forced popup for every event. |
| Backtrack | Recent relevant past conversations first; expandable full task history. |
| Reading | Read/unread is separate from whether an item is handled. |
| Internal team | Designers and supervisors work in the web app with staff accounts. |
| External participants | Clients, client-appointed contractors, carpenters, and similar workers use Telegram. |
| Work review | Worker submits photos; founder approves completion or requests rework. |
| Design review | Founder approval normally allows execution, subject to other prerequisites. |
| Scheduling | Recorded delays automatically update dependent forecasts; independent work can continue. |
| Client status | Routine status questions may be answered from recorded project information. |
| Client decisions/disputes | Founder receives context, handles or delegates, drafts, and explicitly sends the response. |
| Navigation | All projects → project → work → person and required documents. |
| Simplicity | Reveal detail when needed; avoid an always-visible project/chat/alert control center. |

These decisions supersede older documents where they conflict. In particular, the previous frontend plan's restriction against redesign and its deferral of scheduling/notification work do not define the scope of this version.

## 3. Verified baseline and important gaps

This assessment comes from the working checkout, including uncommitted changes. Existing changes must be preserved. Do not reset, clean, or overwrite the working tree to implement this plan.

### 3.1 Available in this checkout

| Source | Existing behavior | Implication |
| --- | --- | --- |
| `frontend/src/App.tsx` | Authenticated project UI, six project tabs, task threads, request review, notification rail, eight-second polling. | Reuse API/state handling, but simplify navigation and remove the permanent rail. |
| `frontend/src/workspace-api.ts` | Typed `/api/workspace` client with same-origin cookies. | Extend the client instead of scattering fetch calls. |
| `src/workspace-server.js` | Local HTTP API, staff sessions, origin checks, membership controls, Telegram intake. | Useful local reference; not proof of deployed service behavior. |
| `src/workspace-store.js` | SQLite users, clients, projects, memberships, tasks, discussions, reads, requests, notifications, audit. | Durable foundation, but tasks lack operational dates, dependency edges, external assignees, completion evidence, and resource requirements. |
| `src/workspace-store.js` activation | Generates task threads, all initially assigned to one selected staff owner. | Must generate role-aware operational work rather than assign every trade to the same person. |
| `src/decision-requests.js` | Explicit question/approval capture, ordinary assigned-client intake, persisted request-sync retries. | Extend ordinary intake to assigned external workers and improve routing; do not add another poller. |
| `src/index.js` | Bot worker integrates capture and retries. | Keep one Telegram update consumer per bot token. |
| `src/workflow-engine.js` | Graph scheduling, finish-to-start/start-to-start edges, delay forecasts, revision-review helpers. | Reuse concepts through a canonical service; complete calendar and scheduling correctness before production writes. |
| `src/residential-interior.js` | Parallel design/site branches, procurement, execution prerequisites, final checks. | Good initial workflow structure; some durations remain unconfirmed. |
| `src/sheets.js`, `src/schema.js` | Bot/Sheets tasks, file revision and review records, operational history. | Preserve/import through mappings and a controlled ownership transition. |

### 3.2 Separate web application

`docs/pilot-backend-handoff.md` and `docs/pilot-api-contract.md` describe a separate web repository and draft backend PRs. They mention PostgreSQL, founder/employee endpoints, attachment proxying, and final Telegram reply publishing.

Those capabilities are documented, not verified here as merged, deployed, or running. The local `/api/workspace` API is not interchangeable with `/api/founder` and `/api/employee`. Phase 0 identifies the production implementation target and reconciles contracts before code is ported.

### 3.3 Gaps that must be resolved

- Web coordination tasks and bot/Sheets tasks currently have separate operational ownership. They cannot appear as one synchronized schedule without a migration and mapping contract.
- Current web notification counts are unread-event counts, not unresolved-intervention counts.
- Current web task resolution can be performed by an owner and is coupled to request resolution. That is incompatible with founder-only completion review and separate question handling.
- Ordinary capture targets the assigned client. A carpenter's ordinary question is not covered merely because client intake exists.
- Telegram file references are not equivalent to durable, authenticated completion-photo storage.
- Existing graph completion/revision helpers require client-approved drawings. New workflows need an explicit founder approval policy rather than an unconditional client gate.
- Existing delay behavior preserves planned/current dates and updates some forecasts. Preserve baseline and actuals, but recompute dependent forecasts correctly across all supported edges.
- Missing durations and actual progress cannot be fabricated by AI.
- Shared login cannot prove which physical founder performed an action. Named responsibility and declared acting-as attribution must be explicit.

## 4. Scope and delivery boundaries

### Required for the complete first version

- Simple all-project home and project workspace.
- Persistent founder intervention queue, badge, ownership buttons, and Backtrack.
- Staff assignments and external participant/task mappings.
- Telegram intake and founder replies with reliable delivery state.
- Required inputs, approved drawing versions, photos, and founder review/rework.
- Task readiness, next actor, dependency scheduling, delay propagation, and optional timeline.
- Deterministic project status and catch-up summaries.
- AI-assisted routing, relevant-history summaries, reply drafting, and bounded status responses after the reliable core works.
- Migration of existing projects, durable event history, access controls, recovery, and pilot acceptance.

### Deliberately deferred

- Client web accounts.
- A public contractor portal or contractor marketplace.
- Billing, estimating, payroll, and inventory purchasing software.
- Automated judgment that construction is physically correct from a photo.
- Automated weather ingestion; recorded rain/site-access reasons are sufficient initially.
- Full Google Calendar synchronization; the requested calendar-like interaction is an in-app view.
- Autonomous trade reordering or resource leveling across projects.
- A general workflow programming interface exposed to founders.
- Automatic interpretation of phone calls or unrecorded site conversations.

## 5. Simple information architecture

### 5.1 Founder home

Visible initially:

- Studio header, project search, founder intervention badge.
- A compact “Since your last visit” section with meaningful changes and commitments.
- Project cards or rows: name, current work, next action, waiting reason if any, forecast status.
- One primary creation action: New project.

Do not show staff administration, dependency diagrams, raw unread totals, resources tables, chat composers, or project configuration on this screen. Empty states should say what to do next.

Project status must never imply health just because there are no unread messages. A stale project shows “No update since …”; an incomplete schedule shows “Finish date not confirmed.”

### 5.2 Project workspace

Default view is “Now,” showing work in progress, blocked work, upcoming ready work, and relevant decisions. Secondary views are “Plan” and “History.” People, files, and setup live behind the project menu or in contextual work detail.

Each work row shows its title, responsible person, a short state, and next action. Expand a task to see its brief, approved files, required inputs, recent discussion, evidence, and available actions.

Do not create separate permanent Tasks, Discussions, Requests, Resources, Team, and Notifications surfaces for the same daily journey. Preserve deep links while consolidating their presentation.

### 5.3 Intervention queue and detail

Badge opens a drawer on desktop and a full-width detail view on small screens. Queue cards show project, person, question/review reason, waiting time, and owner if assigned.

Detail order:

1. What needs the founder's action.
2. Project/task and sender.
3. Relevant media or current approved reference.
4. Backtrack button.
5. Contextual action: Reply, Approve, Request changes, Assign to Gosik, Assign to Nishank.

Assignment is by buttons, not a text field. The reply composer appears only when Reply is selected. Internal discussion is explicitly separate from a Telegram reply.

No unsolicited blocking modal. New events update the badge and may use a brief toast; they must not interrupt writing a reply.

### 5.4 Internal team

Employees land on their assigned work and can open permitted projects. Designers upload/revise files; supervisors report site conditions, progress, delays, and evidence. They do not inherit founder publication or approval permissions.

## 6. Core operating model

Use these separate concepts even when the UI expresses them in one sentence:

| Concept | Meaning | Example |
| --- | --- | --- |
| Responsible party | Accountable for executing a piece of work. | Carpenter. |
| Next actor | Person/role whose action is required now. | Founder answering a finish question. |
| Work state | Where execution stands. | In progress, Waiting, Awaiting review. |
| Intervention state | Whether the founder issue is handled. | Open, Handling, Resolved. |
| Read state | Whether visible context has been read. | Seen through event 145. |
| Delivery state | Whether Telegram accepted the outgoing response. | Queued, Sent, Failed, Unknown. |
| Approval state | Whether the relevant revision/evidence was approved. | Awaiting review, Approved, Changes requested. |
| Schedule state | Earliest forecast and constraints. | Ready, Unscheduled, Delayed. |

Resolving a question does not complete the task. Reading a request does not resolve it. Sending a response does not approve construction. Uploading a photo does not complete work. Moving a date does not bypass missing documents or approval gates.

## 7. State machines and business rules

### 7.1 Work lifecycle

Canonical persisted states: `NotStarted`, `InProgress`, `Waiting`, `AwaitingReview`, `ReworkRequired`, `Completed`, `Cancelled`.

Readiness is derived separately: `Ready`, `MissingInputs`, `WaitingDependency`, `WaitingApproval`, `Unscheduled`, or multiple specific reasons. A task can have sufficient inputs for preliminary design while its execution deliverable remains blocked.

Transitions:

- NotStarted → InProgress: permitted assignee/internal coordinator; start requirements satisfied.
- InProgress → Waiting: question, missing input, approved hold, or recorded site-access delay.
- Waiting → InProgress: all blocking reasons cleared; retain original actual start.
- InProgress/ReworkRequired → AwaitingReview: submission with required evidence.
- AwaitingReview → Completed: founder approval of the current submission only.
- AwaitingReview → ReworkRequired: founder rejection with reason and optional marked reference.
- ReworkRequired → AwaitingReview: new submission; previous evidence remains in history.
- Any open state → Cancelled: founder; dependent implications shown and recorded.
- Completed → reopened work: founder correction event; never silently erase approval history or actual dates.

System-generated collection/approval milestones can close when their required founder decision occurs. No employee endpoint may bypass founder review for review-required deliverables.

### 7.2 Intervention lifecycle

`Open` → `Handling` → `Resolved`, with explicit `Dismissed` for items that require no action. Optional `WaitingInternal` and `WaitingExternal` detail can be represented through next-actor/waiting fields.

- Assignment alone does not resolve an item.
- An uncertain or failed Telegram answer does not resolve a question.
- A question can be resolved after confirmed answer delivery; the execution task stays open.
- A photo review resolves after approval or rejection; rejection creates/maintains the rework action.
- A new blocking follow-up after resolution creates a new intervention linked to the original, preserving past handling.
- Cancellation closes associated open items with an explanation, not deletion.
- Latest-version conflicts produce a refresh prompt rather than overwriting another founder's decision.

### 7.3 Shared founder account

Seed two responsibility profiles: Gosik and Nishank, linked to the shared founder account. These are responsibility identities, not separate logins.

- Queue ownership is stored per intervention and is visible to both browsers.
- Use row versions for simultaneous assignment/decision/send actions; a stale edit gets a conflict response.
- On sensitive actions, record account ID, browser session ID, and declared acting-as profile. Default to the selected owner/profile where available; do not repeatedly ask for names.
- If no profile is declared, attribute “Shared founder account”; do not invent who acted.
- Read state is shared at account level. Catch-up checkpoints can be per session/device so one founder opening home does not consume the other's catch-up context.
- Both founders may respond; prevent duplicate sends of the same reply intent, not all future legitimate replies.
- Ownership is coordination, not an access lock. Reassignment and override are allowed and recorded.

### 7.4 Design and resource gates

Default new workflow policy: founder approves the current drawing revision; site verification and material readiness remain separate prerequisites. Client approval is an optional explicit gate for workflows/contracts that require it.

Do not remove client gates from historical projects without a deliberate policy migration. Map old `Admin approved`/`Client approved` records to explicit decisions and applicable project policy.

Approval does not automatically publish a file. External release is a separate action/visibility decision, so internal drafts cannot accidentally reach contractors.

## 8. Architecture and data ownership

### 8.1 Intended architecture

Keep the existing React frontend, authenticated web service, and Telegram bot service. Add a durable domain layer and worker responsibilities within the selected production stack. Do not introduce microservices for individual features.

Operational flow:

Telegram → persisted incoming update → normalized project event → routing/intervention → founder action → transaction + outgoing message job → Telegram delivery result.

Task changes → workflow/readiness evaluation → deterministic schedule recalculation → project events → compact UI projections → optional AI explanation.

Use database-backed inbox/outbox jobs initially. Live UI may use server-sent events if the target supports them, with bounded polling as a fallback. Event delivery to the UI is never the sole storage of a notification.

### 8.2 Canonical ownership

The web operational database becomes authoritative for migrated project tasks, assignments, dates, resources, approvals, interventions, and history. Sheets becomes a legacy source/reporting projection for migrated projects. The bot becomes an intake and delivery adapter.

Until cutover, legacy projects remain owned by their current system. Each project records ownership mode and cutover version. Do not allow both web and bot commands to mutate the same task independently.

If the separate production web app is the target, implement using its existing database and authentication. If this checkout becomes the target, use the SQLite local implementation for development and make a deliberate deployment persistence decision in Phase 0. A documented PostgreSQL service must be verified before relying on it.

### 8.3 Domain services

- Project service: setup, participants, ownership mode, workflow activation.
- Work service: assignment, progress, next actor, required inputs, lifecycle.
- Intervention service: routing, founder ownership, reading, handling, escalation.
- Conversation service: normalized messages, task links, source context, internal/external visibility.
- Resource service: versions, required-input links, protected media, release state.
- Review service: design/evidence approvals and rework.
- Schedule service: graph validation, forecast calculation, delays, moves, conflicts.
- Delivery service: reply intents, outbox, retries, uncertain delivery reconciliation.
- Projection service: home, Now, catch-up, status facts, badge counts.
- AI service: suggestions/summaries from scoped facts; no direct privileged mutations.

Mutations should commit domain changes and their event/outbox records together. Do not call Telegram inside a long database transaction.

## 9. Data model

Use additive, versioned migrations. The following are logical entities; adapt names to the chosen database rather than duplicating existing tables.

| Entity | Required fields/relationships |
| --- | --- |
| Founder profile | id, displayName, accountId, active. |
| Project | clientId, timezone, calendarId, workflowVersionId, ownershipMode, legacy mapping, lifecycle, baseline/forecast finish, scheduleVersion. |
| Participant | projectId, kind (staff/client/external), staffUserId or Telegram user ID, name, trade/role, membership state. |
| Work | projectId, templateStepId, phase/trade/area, brief, responsibleParticipantId, internalCoordinatorId, state, rowVersion, start/completion policy. |
| Work dates | baselineStart/Finish, forecastStart/Finish, actualStart/Finish, duration, notBefore, pin constraint, unscheduled reason. |
| Dependency | projectId, predecessorWorkId, successorWorkId, FS/SS type, lag, calendar policy. |
| Required input | workId, requirement label/type, start/finalization use, required revision/resource link, verified state. |
| Resource | projectId, type, storage reference, source event, title, visibility. |
| Resource revision | resourceId, version, uploader, parent revision, approval state, releasedAt, supersededAt. |
| Work-resource link | workId, revisionId/resourceId, purpose (input/output/reference/evidence). |
| Message | projectId, workId if linked, internal/external visibility, sender, body, source timestamp, receivedAt, source IDs, replyTo, edit/delete markers. |
| Incoming update | botId, Telegram updateId, raw bounded payload/reference, receipt and processing status, attempts. |
| Message-work link | messageId, workId, method, confidence if suggested, confirmedBy; primary topic plus related topics where needed. |
| Intervention | projectId, workId if known, kind, sourceMessage/submissionId, state, ownerFounderProfileId, nextActor, urgency, rowVersion. |
| Intervention read | interventionId, sharedAccountId, lastSeenEvent/version, seenAt. |
| Review submission | workId, cycle, revision/evidence IDs, submitter, submittedAt, status. |
| Review decision | submission/revisionId, policy stage, outcome, reason, declared founder, decidedAt. |
| Delay | workId, cause, duration/end date, reportedBy, effectiveAt, authority state, scheduleChangeId. |
| Schedule change | projectId, version before/after, initiating event, affected dates, conflicts, explanation. |
| Commitment | project/workId, owner, action, dueAt if known, sourceEventId, state. |
| Reply intent | intervention/sourceMessageId, destination, body/version, explicit/autoStatus mode, idempotencyKey, delivery state, Telegram message IDs. |
| Job/outbox | kind, payload/reference, unique key, attempt count, nextAttemptAt, lease, result/error. |
| Project event | monotonic sequence, project/workId, event type, occurredAt/receivedAt, actor, source, payload/reference. |
| Catch-up checkpoint | account/session, lastAcknowledgedEvent, lastVisitAt. |
| AI artifact | scope, input event version, model/version, output, evidence references, stale flag. |
| Legacy mapping | legacy system/project/task/revision IDs, canonical ID, imported version, ownership mode. |

Constraints: unique incoming `(botId, updateId)`; unique Telegram message `(botId, chatId, messageId)`; unique task generation `(projectId, workflowVersionId, templateStepId)`; unique canonical legacy mapping; unique reply idempotency key within its account/project scope; dependency endpoints in the same project; foreign-key checked ownership and review links.

Indexes: active interventions by project/state/owner, event sequence per project, messages by task/source/reply, tasks by project/responsible party/state, queued jobs by due time, resource revisions, legacy mapping, and source-message links.

## 10. Telegram intake and task routing

### 10.1 Reliable ingestion

1. Retain the existing single update consumer per bot token.
2. Persist updates before acknowledging/advancing the consumer checkpoint.
3. Process the durable inbox with bounded retries and deduplication.
4. Preserve text, captions, sender, group, reply chain, media groups, edits, and original timestamps.
5. Resolve the group to one project and the sender to a known participant.
6. Classify participation: internal staff, founder, approved client, approved external worker, or unknown.
7. Capture relevant ordinary messages from active external workers; explicit commands remain a fallback.
8. Store unlinked-group/unknown-sender items in a recoverable intake state; no guessed project assignment.

Telegram bot permissions/privacy mode must be checked in a test group. Do not promise history that the bot never received. Older relevant history can be imported explicitly, linked manually, or shown as unavailable.

### 10.2 Routing order

Prefer deterministic evidence:

1. Reply to an assignment/published task message with a stored task mapping.
2. Explicit task identifier or task-specific reply context.
3. Known participant with exactly one relevant active work item.
4. AI suggestion using the project's active work and recent external discussion.
5. Unmatched intervention for founder/internal coordinator linkage.

An ambiguous plumbing-versus-carpentry question must not be silently assigned. The founder can choose from a small relevant task list. Confirmed links improve subsequent context routing.

### 10.3 Message types

- Routine progress question: eligible for status-response policy.
- Work clarification/blocker: founder intervention and next-actor update; do not mark every question as blocking.
- Complaint/design change/payment/scope question: founder intervention.
- Progress photo: evidence or update, not automatically a completion claim.
- Explicit completion claim with photos: review submission.
- Acknowledgement/social chatter: retain relevant source context without increasing unresolved badge count.
- Voice note: retain/play original; add transcription later with uncertainty and source linkage.

Classifications are revisable and do not change execution state without a permitted command or deterministic rule. Client messages and attachments are data, not instructions granting the AI permissions.

## 11. Interventions and Backtrack

### Queue behavior

- Badge counts unresolved actionable items across all projects, independent of unread status.
- Inside the queue, distinguish new/unread items from already-seen pending work.
- Default order: blocking/urgent items, then oldest waiting; allow owner filter.
- Collapse multiple messages about the same open issue into one item with follow-up count.
- Only meaningful events reopen/create items; bot echoes and generic acknowledgements do not.
- Assign to Gosik/Nishank updates both sessions without losing a response draft.
- Explicitly handled/dismissed items remain searchable in history.

### Backtrack assembly

Return a bounded, evidence-linked context bundle:

1. Original assignment snapshot: who, what, when, due date, instructions, released revision.
2. Most recent relevant discussion, including reply chains and the latest founder response.
3. Current approved drawing and any newer revision under review, clearly distinguished.
4. Recorded decisions, unresolved commitments, and current blocking reason.
5. Full history link with pagination.

Select by confirmed task links/reply chains first. Semantic retrieval can rank additional messages only within the same authorized project. Never pull another client's messages into context.

Show source timestamps and chronological order. Preserve old assignment snapshots when later instructions change. New context arriving after the panel opens shows a refresh indicator; it must not overwrite a typed reply.

## 12. Documents and evidence

### Client intake

- The initial collection work requests existing maps, drawings, images, measurements, and available references.
- Store each resource once and link it to relevant design/site tasks.
- The internal coordinator/founder verifies completeness; a single received file does not automatically mean collection is complete.
- Generate required-input checklists from the workflow; allow project-specific additions.
- Separate inputs sufficient to begin preliminary design from verified inputs required to finalize/release it.

### File versions

- Designers upload revisions instead of replacing files in place.
- Approved revisions remain traceable and immutable in history.
- New draft does not silently replace the contractor's approved instructions.
- New approval may supersede the prior release; if work has started, create a change-impact intervention rather than pretend the old work never happened.
- External access is restricted to explicitly released files.
- Deleting/unavailable source media is reflected honestly; do not claim the file is preserved if only a Telegram reference remains.

### Storage and access

Use the target's authenticated media pathway initially, then durable object storage for construction evidence and drawings before broad rollout. The backend owns provider credentials and download authorization. Enforce file size/type limits, bounded uploads, project membership checks, and recoverable archival jobs.

Preserve Telegram file IDs and media provenance. UI shows upload/processing/unavailable states. Support image zoom and side-by-side approved drawing versus evidence; founder judgment remains required.

## 13. Completion review and rework

1. Worker replies to their assignment with “done” and photos, or supervisor submits on their behalf.
2. The system links the evidence to the correct task. Ambiguous media is held for linkage.
3. Task enters AwaitingReview; founder intervention is created once per submission cycle.
4. Review panel shows the planned/released revision and submitted photos.
5. Founder approves or requests changes. Rejection requires a reason.
6. Approval records actual completion, closes the review intervention, and reevaluates dependents.
7. Rejection increments the cycle, preserves all prior evidence/decisions, returns work to ReworkRequired, and creates a correction assignment/draft.
8. Feedback goes to Telegram only through an explicit founder send action, or remains queued as unsent feedback visible to founders.

Approval never silently emits an external message. A concise “Approve & send” compound action may be added only if it previews the exact outgoing text and destination.

## 14. Deterministic scheduling

### 14.1 Scheduling contract

Keep baseline, forecast, and actual dates separate. The main timeline shows the current forecast; original commitments remain in history and can be compared on demand.

Store calendar dates as date-only values, event timestamps as UTC, and display in the project timezone (initial default Asia/Kolkata). Use calendar days as the initial explicit scheduling default, consistent with the current engine, with configurable working days and holidays before production calendars are relied on. Do not infer Sundays off from one conversational example.

Use a documented date convention in the service: start is inclusive and finish is exclusive for internal arithmetic. Display the final occupied day to users; translate legacy inclusive end dates on import. Zero-duration milestones are explicit. Unknown durations remain unknown, not zero or one day.

### 14.2 Engine requirements

- Validate the graph and reject cycles, unknown edge types, missing tasks, and cross-project edges.
- Compute in topological order, independent of database row ordering.
- Support FS and SS with lag and explicit calendar arithmetic; defer unsupported relationships.
- FS forecast uses predecessor completion/forecast finish. SS uses actual/forecast start.
- Readiness checks actual predecessor events and review/resource gates; forecast dates alone never authorize a start.
- At joins, the latest applicable constraint determines the start.
- Preserve duration when moving an unstarted task; apply configured not-before and pin constraints.
- Delay an ongoing task's remaining forecast without rewriting its actual start.
- Recalculate unstarted dependents; do not rewrite completed actuals or retroactively move ongoing tasks.
- Started/pinned tasks with new conflicts create an intervention explaining the constraint.
- Cancelling a predecessor does not automatically count as satisfying it; founder selects replacement, waiver, or cancellation of successors.
- Rework affects the relevant gate/dependents; already-started work gets a change-impact item.
- Mark schedule completeness and blockers; a partly dated graph must not produce an unconditional full-project finish date.
- Recompute project finish from required terminal work; retain latest known dates separately when forecast is incomplete.

### 14.3 Delay flow

Supervisor records task, reason, expected delay or next review date, and whether work is fully stopped. An authorized operational delay automatically recalculates forecasts in one versioned transaction. Founders receive the explanation, not a mandatory approval for every recalculation.

Legacy founder-approved delay requests must be adapted explicitly for migrated projects. Scope/budget commitments, dependency edits, and disputed delays remain founder decisions. A raw AI guess about rain is not an authorized operational delay.

If recovery date is unknown, show a hold and next check date instead of inventing a three-day estimate.

### 14.4 Parallel work

After the delay, derive work that can continue from its existing readiness, inputs, and assignment. Do not invent overlap or bypass site verification. A founder summary can say:

“Site verification is delayed three calendar days. Preliminary design can continue from the client drawings. Execution is waiting for verified measurements.”

Shared person/resource conflicts are detected and surfaced. Keep resource leveling manual initially; do not automatically reassign a designer or move unrelated projects.

### 14.5 Drag-and-drop timeline

- Timeline is secondary, never required to answer an intervention.
- Dragging proposes a date constraint, not a dependency bypass.
- Show affected successors and conflicts before committing the deliberate move.
- Valid move commits and recalculates downstream work automatically.
- Preserve baseline and record a schedule-change event.
- Offer date-edit controls as accessible/mobile alternatives to drag-and-drop.
- Show undated work in an Unscheduled section with its missing duration/input reason.
- Optional undo creates a compensating change and respects later updates; it is not a blind database rollback.

## 15. Reply publishing and client status

### Founder-authored replies

1. Open Reply in an intervention.
2. Compose or accept an AI draft with source context visible.
3. Preview exact text, attachments, group, and original message target.
4. Explicit Send creates a durable reply intent/outbox job using a stable idempotency key.
5. Worker sends; record Telegram message ID and confirmed delivery.
6. Delivery result updates both browsers. Failed/Unknown states remain visible.

States: Draft, Queued, Sending, Sent, Failed, Unknown. Retry definitively failed attempts with the same intent key. If transport times out after the send may have succeeded, mark Unknown and block automatic resend. Telegram transport cannot promise exactly-once delivery under every failure; a founder reconciliation action records checked outcome before any new send.

Internal comments never publish automatically. Editing a sent reply is a separate versioned action, if supported, not a silent overwrite of history.

### Routine automatic status

Enable only after canonical project status, intake, and delivery reliability pass acceptance.

Eligible answers use a bounded public status projection: confirmed progress, current waiting reason suitable for external sharing, recorded forecast, and next planned action. No internal criticism, confidential staff discussion, or speculative dates.

Auto-status has a project policy, message classification threshold, freshness checks, duplicate/rate suppression, and an audit trail. If classification is uncertain or facts are stale, route to the founder instead of sending a confident answer. Complaints, scope decisions, disputed causes, money, and design interpretation always route to founder handling.

A factual recorded reason such as rain can appear in the public update. A status answer never implies that a deadline is confirmed when the schedule is incomplete.

## 16. Catch-up, commitments, and AI

### Deterministic context recovery first

Compute “Since your last visit” from project events, not unread messages alone. Include new blocking questions, approvals/rework, significant date changes, completed work, and overdue recorded commitments. Group by project and link every statement to its source.

Use a stable catch-up window and explicit acknowledgment/checkpoint. Background polling must not consume the window. Shared account sessions have separate catch-up checkpoints while sharing the intervention queue.

Assignments are not automatically considered complete. Recorded “I will send the drawing tomorrow” can become a suggested commitment; founder confirms the owner/date. Unrecorded conversations require a quick note/manual commitment.

### AI responsibilities

- Suggest question intent and likely task when deterministic mapping is insufficient.
- Summarize relevant Backtrack context with evidence links.
- Draft replies and explain recorded delays/schedule impact.
- Suggest commitments from stored conversation, with confirmation.
- Turn structured public facts into a routine status response under the policy above.

### AI boundaries

- Never invent progress, documents, actual dates, approvals, or reasons.
- Never approve work from image similarity.
- Never directly change dependency edges, roles, permissions, dates, or completion state.
- Never treat client text as authorization to publish internal context.
- AI artifacts carry input-event version; new evidence invalidates/rebuilds stale summaries.
- Cache bounded project-scoped summaries. AI outage leaves queue, history, scheduling, and manual replies usable.
- Start with a small labelled corpus from test data covering mixed-language questions, ambiguous tasks, completion claims, complaints, and chatter. Measure routing mistakes and missed interventions before expanding automatic behavior.

## 17. API contracts to add

The following use logical `/api/workspace` names to fit this checkout. Phase 0 maps them to the actual production route conventions. They are proposed endpoints, not claims that current routes exist.

| Feature | Proposed endpoints |
| --- | --- |
| Founder home | `GET /home`, `GET /catch-up`, `POST /catch-up/acknowledge` |
| Project Now | `GET /projects/:id/now` |
| Interventions | `GET /interventions`, `GET /interventions/counts`, `GET /interventions/:id` |
| Queue actions | `POST /interventions/:id/assign`, `/read`, `/resolve`, `/dismiss` |
| Context | `GET /interventions/:id/backtrack`, `GET /tasks/:id/history` |
| Work | `GET/POST /projects/:id/tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/start`, `/progress`, `/wait` |
| Participants | `GET/POST /projects/:id/participants`, `POST /tasks/:id/assign` |
| Resource inputs | `GET/POST /tasks/:id/requirements`, `POST /tasks/:id/resources` |
| Resource versions | `POST /projects/:id/resources`, `POST /resources/:id/revisions`, protected download/preview |
| Reviews | `POST /tasks/:id/submissions`, `POST /submissions/:id/review`, `POST /revisions/:id/review` |
| Scheduling | `GET /projects/:id/schedule`, `POST /tasks/:id/delays`, `POST /projects/:id/schedule/preview`, `/apply` |
| Replies | `POST /interventions/:id/replies`, `GET /replies/:id`, `POST /replies/:id/retry`, `/reconcile` |
| AI assistance | `POST /interventions/:id/draft`, `GET /tasks/:id/context-summary` |
| Integration | Existing authenticated Telegram intake extended with normalized message/task/source metadata; durable acknowledgments |

Mutations include expected row/schedule version and an idempotency key where duplication matters. Return stable IDs, resulting versions, domain state, and an event cursor. Standard responses: 401 expired login, 403 unauthorized action, 404 missing/inaccessible resource, 409 stale/conflicting action, 422 invalid lifecycle/dependency, 429 bounded rate limits.

Lists and history use cursor pagination. Counts are server computed across the full authorized set, not just the current page. Do not fetch every project's full message history with the home response.

## 18. Frontend implementation structure

Proposed decomposition, adapted to the chosen frontend:

- `FounderHome`: project overview and catch-up.
- `ProjectWorkspace`: Now/Plan/History and contextual project menu.
- `InterventionBadge`, `InterventionQueue`, `InterventionDetail`.
- `FounderAssignmentButtons`: exact Gosik/Nishank actions.
- `BacktrackPanel`: recent context plus expandable full history.
- `TaskDetail`: brief, next actor, inputs, discussion, evidence.
- `ReviewPanel`: approved plan versus submission, approval/rework.
- `ReplyComposer`: explicit external destination and delivery state.
- `InternalMessageComposer`: distinct visibility and endpoint.
- `ProjectTimeline`: optional scheduling view and impact preview.
- `ResourceViewer`, `RequiredInputs`, `EmployeeWorkList`.
- API/domain types split by work, intervention, resource, scheduling, and delivery.

Reuse existing session, abort/stale-response handling, dialogs, typography, and components. Move domain rules into backend projections; frontend should not reimplement schedule arithmetic or derive authoritative approval readiness.

Remove the permanent right-hand notification rail, six-tab daily navigation, duplicate task/query lists, and raw metadata labels. Preserve drafts on refresh. Retain direct task/project links through redirects/adapters. Provide keyboard navigation, focus restoration, responsive detail views, readable image zoom, and loading/empty/error/saving states.

## 19. Implementation phases and exit gates

Effort below is provisional engineering effort, not a promised calendar deadline. It assumes reuse of the existing stack and one experienced developer doing implementation plus relevant tests. Unexpected production/repository gaps can change it.

### Phase 0 — Establish the target and ownership contract (2–3 developer days)

Work:

- Inspect actual production web repository, branch/PR status, environment, authentication, datastore, API, and deployed capabilities.
- Record the authoritative implementation target and relevant working-tree changes.
- Inventory existing projects/tasks/resources, duplicate coordination records, legacy commands, and attachment capabilities.
- Reconcile current API documents with running/checked-in behavior; do not mix `/workspace` and `/founder` contracts.
- Fix product defaults in a decision log: shared founder profiles, review gates, date convention, calendar, canonical ownership, migration mode.
- Define test fixtures and a one-project migration rehearsal.

Exit: one selected target, one authority per project field, compatible migration contract, and a reviewed execution backlog. UI/schema groundwork may be prepared without guessing production state.

### Phase 1 — Canonical model, events, and safe migrations (4–6 days)

Work:

- Add participants, responsibility profiles, state/version fields, events, work mappings, and inbox/outbox tables.
- Separate request, read, task, and delivery lifecycle fields.
- Add transactions, uniqueness constraints, and idempotent domain commands.
- Introduce canonical permission checks for founder/employee/external adapter actions.
- Preserve historic data and add project ownership mode.

Exit: new task/event/assignment records survive restart; duplicate commands do not duplicate work; employee cannot approve; migration rollback rehearsal passes without deleting history.

### Phase 2 — Simple shell and deterministic home (3–5 days)

Work:

- Build all-project home and Project Now from real projections.
- Replace permanent rail and six-tab workflow with contextual views.
- Add shared founder profile selection/assignment UI groundwork.
- Display stale updates and unconfirmed forecasts honestly.
- Preserve legacy deep links and drafts.

Exit: founders can open a project and identify current work/next action without navigating separate chat and resource screens; mobile and keyboard paths work.

### Phase 3 — Intervention queue, reads, ownership, and Backtrack (4–6 days)

Work:

- Implement unresolved counts, shared reads, owner buttons, conflict handling, and intervention grouping.
- Build task-linked chronological context and full-history pagination.
- Add manual capture/linking of an external issue for early testing.
- Support meaningful follow-ups and stale-panel refresh without draft loss.

Exit: reading never removes unresolved work; both sessions see assignments; concurrent claim/review attempts do not overwrite silently; Backtrack restores the actual assignment and relevant conversation.

### Phase 4 — Reliable external intake and founder replies (5–7 days)

Work:

- Persist Telegram updates and extend ordinary external-worker intake.
- Map assignment messages/replies to canonical tasks.
- Add ambiguous linkage fallback and attachment intake.
- Implement reply intent/outbox, delivery result, retry and Unknown reconciliation.
- Protect internal/private context from external publication.

Exit: carpenter's ordinary question reaches the correct intervention, founder answer reaches the original group after explicit Send, and restart/retry does not lose the work item or blindly duplicate uncertain sends.

### Phase 5 — Inputs, versions, founder reviews, and rework (5–7 days)

Work:

- Add required-input verification and reusable project resources.
- Add authenticated durable file/evidence storage and revision release rules.
- Implement design policy gates, completion submissions, founder-only decisions, rejection feedback, and rework cycles.
- Decouple work completion from question handling and outgoing delivery.

Exit: founder can compare evidence to the approved plan, reject and receive a corrected submission, then approve; execution cannot use an unreleased draft or bypass required gates.

### Phase 6 — Scheduling engine and automated delay effects (6–9 days)

Work:

- Adapt/rework existing graph functions into canonical schedule service.
- Add date/calendar contracts, milestones, unknown-duration behavior, strict validation, and topological recalculation.
- Support baseline/forecast/actual dates, delays, joins, FS/SS behavior, pin/conflict handling, and rework implications.
- Persist versioned schedule changes and deterministic plain-language explanations.
- Show ready parallel work and shared-person conflicts.

Exit: rain-delay fixture moves the correct dependents, preserves independent work and actuals, and never presents a complete finish date from incomplete inputs.

### Phase 7 — Optional timeline interaction (3–5 days)

Work:

- Build project Plan with readable task groups and undated work.
- Add drag/date-edit → preview → commit flow with conflict handling.
- Add baseline comparison and change history on demand.
- Keep ordinary founder responses independent of timeline usage.

Exit: a task can be moved with keyboard or pointer, valid successors update, and invalid dependency moves cannot be committed.

### Phase 8 — Catch-up, commitments, and AI assistance (4–6 days)

Work:

- Add session-aware catch-up projections, recorded commitments, source links, and checkpoint acknowledgment.
- Add evidence-grounded Backtrack summaries and reply drafts.
- Add conservative intent/task suggestions and manual correction.
- Evaluate test corpus and log classification/routing failures.
- Enable bounded automatic routine-status responses only after freshness/visibility/delivery checks pass.

Exit: Monday catch-up reconstructs Friday activity accurately; AI downtime leaves the core usable; complaints and uncertain questions reach the founders rather than receiving speculative answers.

### Phase 9 — Migration rehearsal and real-project pilot (4–6 days)

Work:

- Import and reconcile a selected project's legacy records.
- Run founder/designer/supervisor/external-worker journeys in a designated test group.
- Verify shared-account simultaneous actions, live photos, live delivery, dates, restarts, and access removal.
- Gather usability feedback from both founders; simplify any surface that requires procedural explanation.
- Run monitored one-project cutover, then expand to remaining active projects after acceptance.

Exit: a real project operates with one task authority, the complete carpenter loop and delay loop pass, and founders can recover context after a break.

### Phase 10 — Rollout and operational hardening (3–5 days)

Work:

- Complete persistence backups/restore, job recovery, monitoring, and deployment runbooks.
- Tune projection queries and bounded live refresh.
- Verify attachment recovery and rollback modes.
- Finalize help text, staff onboarding, and remaining rollout fixes.

Exit: deployment/restart does not lose incoming requests, pending reviews, outgoing delivery state, or schedules; ownership and recovery procedures are documented.

Total planning range: 43–65 developer days. Calendar time depends on staffing, existing production readiness, review cycles, and pilot feedback. Sequence is dependency-driven; do not promise a fixed completion date from this estimate.

## 20. Ordered backlog and proposed changes in this checkout

| Order | Work item | Primary area | Completion evidence |
| --- | --- | --- | --- |
| 1 | Confirm target/canonical ownership | architecture decision + production inspection | verified target and API map |
| 2 | Versioned schema/events/mappings | workspace store or production DB | migration and restart tests |
| 3 | Participant/external work assignment | domain service + Telegram adapter | assignment mapping fixture |
| 4 | Work/review/read state separation | store/API/types | no employee completion bypass |
| 5 | Shared founder queue | intervention service + UI | two-session concurrency fixture |
| 6 | Simple home/project Now | App decomposition + projections | founder navigation walkthrough |
| 7 | Backtrack | events/messages/resources query | chronological source-linked context |
| 8 | Durable intake/external questions | decision-requests + index/worker | ordinary carpenter question captured |
| 9 | Reply outbox and reconciliation | delivery service/worker + composer | Sent/Failed/Unknown fixtures |
| 10 | Resource requirements/media | resource service + file UI | authorized persisted input/evidence |
| 11 | Founder approval/rework | review service + engine policy | rejection/resubmission/approval loop |
| 12 | Canonical dependency engine | workflow-engine adapter/service | shuffle-invariant scheduling fixtures |
| 13 | Delay + parallel work projections | scheduling/API/Now | rain delay acceptance |
| 14 | Timeline | optional Plan component | accessible move with cascade |
| 15 | Catch-up + commitments | event projections | break-and-return scenario |
| 16 | Scoped AI/status policy | AI service + evaluation | no unsupported claims/actions |
| 17 | Pilot cutover | import/mappings/reporting | live project acceptance |
| 18 | Recovery/rollout | jobs/backups/runbooks | restart and restore rehearsal |

Existing filenames to evolve if this repository is chosen: `src/workspace-store.js`, `src/workspace-server.js`, `src/decision-requests.js`, `src/index.js`, `src/workflow-engine.js`, `src/project-service.js`, `src/schema.js`, `frontend/src/App.tsx`, `frontend/src/workspace-api.ts`, `frontend/src/workspace-dialogs.tsx`, and `frontend/src/workspace.css`.

Introduce focused domain modules/migrations rather than continuing to grow a single store class and compressed App component. Keep repository-specific paths aligned with the actual production target.

## 21. Migration and compatibility

1. Back up operational database and export relevant Sheets records before cutover.
2. Dry-run project/task/participant/resource mappings; match by stable IDs, never title alone.
3. Mark internal coordination duplicates explicitly; do not merge distinct tasks merely because names match.
4. Import historic messages only where accessible, preserving sender/source and visibility.
5. Preserve old statuses in migration metadata. Old `Resolved` threads are not automatic proof of founder-approved completion.
6. Mark uncertain historic review state for founder verification without presenting all historic items as newly urgent.
7. Copy legacy dates with their semantics; derive duration only where valid, and leave unknown values unset.
8. Run the scheduler in shadow mode and compare forecasts before enabling automatic writes.
9. Pause task writes briefly per pilot project, perform final reconciliation, flip canonical ownership, then resume.
10. Disable or proxy legacy task/delay/approval mutations for migrated projects.
11. Sheets receives one-way reporting updates with durable retry and visible sync lag.
12. Keep old IDs/deep links through mapping redirects.

Rollback: before operational cutover, revert feature flags while retaining additive data. After canonical writes begin, do not simply reenable legacy independent edits. Pause, export/reconcile new events, and perform a controlled ownership rollback. External messages already sent remain in history and cannot be unsent by a database rollback.

## 22. Acceptance scenarios

### A. Friday carpenter question

- Founder assigns a task and approved reference; message IDs map to work.
- Carpenter asks a question later in ordinary Telegram text/reply.
- Badge increases once and shows project/question without losing sender context.
- Read clears only unread styling.
- Assign to Gosik appears in Nishank's session.
- Backtrack shows assignment time, exact instructions, last relevant discussion, approved drawing.
- Founder sends reply; Sent is recorded; task remains open.
- Blocking next actor returns to the worker only when the actual blocking issue is cleared.

### B. Evidence and correction

- Completion photos create AwaitingReview, not Completed.
- Employee cannot approve through direct API access.
- Founder rejection keeps drawings/photos/history and requires feedback.
- Corrected submission creates a new cycle.
- Approval completes the task and reevaluates dependent readiness once.

### C. Rain delay with independent work

- Site check has an authorized three-day delay and recorded reason.
- Dependent execution forecast moves as constrained.
- Independent design remains scheduled and visible as able to continue.
- An SS successor does not move merely because its already-started predecessor's finish moves.
- A join moves only if the changed predecessor becomes the binding constraint.
- Started work/actuals remain intact; new conflict is visible.
- Client status uses the recorded reason and the correct confirmed/estimated date wording.

### D. Shared founder concurrency

- Both browsers read the same pending item.
- Simultaneous differing assignment/approval requests produce one accepted decision and one clear conflict.
- Retried identical reply intent cannot create another outgoing job.
- A second legitimate follow-up answer is permitted as a new intent.
- Account-level read state and session-level catch-up behave as documented.

### E. Missing and changing information

- Missing maps block the tasks requiring them; preliminary work only starts with its own sufficient inputs.
- Unknown durations remain Unscheduled; project finish is incomplete.
- A new draft does not replace the released drawing.
- New approval after execution started creates a change-impact item.
- Unavailable historic media shows an honest placeholder.

### F. Reliability and isolation

- Bot/web outage leaves a persisted intake item for retry.
- Restart resumes unsent jobs; uncertain sends remain Unknown.
- Unlinked group is recoverable, not routed to another project.
- Ambiguous task question requires linkage, not guessed work state.
- Removed employee loses direct task/message/media access.
- Internal comments do not appear in Telegram or automatic public status.
- AI failure leaves manual operations working.

## 23. Verification strategy

This planning-only change does not require rerunning application tests. During implementation, use the existing backend suites as regression coverage and add meaningful tests for the changed domain rules.

Existing commands: `npm run test:workspace`, `npm run test:requests`, `npm run check`, `npm run frontend:build`. Their previous documented pass status is not a fresh verification of this plan or deployed behavior.

Add targeted coverage:

- Lifecycle/review/permission tests, including direct endpoint bypass attempts.
- Deterministic graph fixtures: diamonds, multiple branches, FS/SS, reversed row order, unknown duration, zero milestone, cycle, hold, cancellation, late approval, pin, and actual dates.
- Property checks: unrelated branch stable; completed actuals unchanged; recomputation idempotent; no permitted dependency violation; repeated source/delay event applies once.
- Transaction/concurrency tests for two browser sessions, shared responsibility, reply intent, and schedule version conflicts.
- Inbox/outbox recovery tests for before-send, after-send timeout, crash/restart, duplicate update, and definitive failure.
- Media access/persistence and superseded-file tests.
- Browser journey tests for intervention handling, review/rework, context retention, mobile/keyboard paths, and draft preservation.
- AI evaluation with corrected task links, source grounded claims, stale facts, malicious message content, and sensitive/public projection boundaries.
- Live acceptance in a designated test group after mock/integration checks pass; offline tests alone cannot validate Telegram visibility, live attachment handling, or production persistence.

Repeat affected checks after fixes. Do not add screenshot snapshots or broad repeated runs that merely mirror implementation without verifying a user outcome.

## 24. Observability and operational support

Track request received → persisted → intervention visible latency, pending intake jobs, outbox delay, failed/Unknown deliveries, oldest unresolved intervention, stale project updates, incomplete schedules, schedule conflicts, missing media, and projection failures.

Keep operational diagnostics in an admin/developer view. Founders see a small actionable message such as “Reply delivery needs checking” rather than provider errors or queue metadata.

Use correlation IDs across source update, intervention, task, reply, and schedule event. Do not log tokens, private keys, full confidential attachments, or unrestricted client conversation payloads. Maintain durable backups and test a restore containing pending jobs and file references.

Provisional pilot targets, to measure rather than claim in advance:

- Relevant Telegram questions appear in the visible queue within 15 seconds under normal service conditions.
- Founder can understand a typical intervention and reach Reply/Review within three meaningful interactions from home.
- Backtrack returns the original assignment and latest relevant exchange without searching Telegram.
- Every recorded delay produces a traceable schedule impact or explicit conflict/incomplete result.
- All unresolved items survive read, refresh, restart, and founder handover.
- No duplicate application reply intent or unauthorized completion in acceptance tests.
- Founders can identify what changed after a break using the home screen without opening every project.

## 25. Risks and mitigations

| Risk | Concrete mitigation |
| --- | --- |
| Two task authorities | Per-project ownership mode, stable mappings, controlled cutover, proxy/disable old writes. |
| Simple UI hides needed context | Backtrack and full history on demand, always-visible next actor/waiting reason. |
| No one updates progress | Minimal staff actions, source-linked Telegram evidence, stale-state signals; no fabricated progress. |
| Shared login obscures actor | Named owner/declared acting-as plus session audit; honest shared-account attribution. |
| Chat noise overwhelms badge | Classify/group actionable issues, preserve manual correction, no badge for every message. |
| Wrong task routing | Prefer reply mappings; unresolved linkage for ambiguity; AI suggestion only. |
| Incorrect schedule cascades | Topological deterministic calculation, gates separate from dates, tests for joins/SS/calendar/actuals. |
| Wrong drawing used on site | Explicit release/version references, immutable history, change-impact review after start. |
| Duplicate/lost Telegram replies | Durable inbox/outbox, idempotent intents, Unknown handling and reconciliation. |
| Unsupported public AI answer | Freshness/public projection policy, escalation, evidence references. |
| Old project data incomplete | Migration provenance, unconfirmed states, shadow scheduling and founder verification. |
| Deployment uses ephemeral local data | Verify production persistence and restore before rollout; no assumed database readiness. |

## 26. First implementation increment

Begin with the ownership/state foundation and one thin working journey, not the entire redesigned dashboard at once:

1. Confirm the production target and map the current APIs.
2. Add canonical participant/task linkage, intervention state, named founder responsibility, and event provenance.
3. Replace the raw alert rail with the requested badge and one intervention detail.
4. Build deterministic Backtrack for that task.
5. Capture one carpenter question and publish one founder response reliably.
6. Add photo submission and founder approval/rework to the same journey.

Then extend required inputs, schedule automation, the optional timeline, catch-up, and AI in the phase order above.

## 27. Definition of done

The complete version is done when the designated live project demonstrates all of the following:

- Founders use a simple home/project/intervention flow with the shared account.
- External questions and evidence arrive in the correct context without manual Telegram searching.
- Gosik/Nishank responsibility and read versus handled state work across simultaneous sessions.
- Backtrack restores relevant history, assignments, and approved references.
- Founders explicitly send decision replies, and delivery failures remain actionable.
- Work completion requires appropriate founder review, with traceable correction cycles.
- Required inputs and released revisions control readiness.
- Delays update the correct dependent forecasts while preserving independent work, actuals, and baseline history.
- Catch-up reconstructs recorded changes and commitments after a break.
- Routine automatic status uses fresh public facts; uncertain/decision questions reach founders.
- Migrated projects have one operational authority and recoverable history.
- Restart, restore, access removal, and production media/delivery checks pass.

Screens that look correct with mock data are not completion. The intervention, execution, scheduling, and recovery journeys must work with real persisted state.
