> Historical record. Use the current application README and architecture guide for setup and ownership.

# Frontend Implementation Plan

**Project:** Studio Iksha Workflow Management  
**Pilot date:** 7 October 2026  
**Owner:** Frontend developer  
**Scope:** Frontend implementation only

## 1. Objective

Complete the core pilot journey using real backend data:

**Create project → Assign client → Select workflow → Start workflow → Receive Telegram query/photo → Discuss internally → Convert query to task → Assign/update task → Publish final reply → Verify persistence.**

Reuse the existing React screens, components, styles, and navigation. Do not redesign the application for the pilot.

## 2. Dependencies and boundaries

- The API additions require web backend PR #5 to be reviewed, merged, and deployed: https://github.com/parashrautela/workflow-managment-/pull/5.
- Automatic client-message intake requires Telegram backend PR #4: https://github.com/parashrautela/telegrambot/pull/4.
- Use `pilot-api-contract.md` for exact request/response fields and backend limitations.
- Preserve the existing founder/employee cookie authentication. Clients participate through Telegram.
- The web pilot workflow creates internal coordination tasks. The separate bot/Sheets workflow is not synchronized with those tasks. Do not display them as one shared schedule.
- Deployment configuration, bot client-role approval, bot workflow selection, and any missing backend behavior belong to the backend/deployment owner.
- Never put integration secrets or bot tokens into frontend code, browser storage, or client requests.

## 3. Execution order

| Phase | Priority | Deliverable | Dependency |
| --- | --- | --- | --- |
| 1 | P0 | Shared API handling and permission states | Deployed web API |
| 2 | P0 | Project/client/workflow setup | Phase 1 |
| 3 | P0 | Tasks and task discussions | Phase 2 |
| 4 | P0 | Founder and employee client-query inbox | Phase 1; deployed bot integration |
| 5 | P0 | Query decisions and task conversion | Phases 3–4 |
| 6 | P0 | Final reply publishing and delivery states | Phase 4 |
| 7 | P0 | Pilot acceptance test and fixes | Phases 1–6 |
| 8 | P1 | Member/account revocation controls | Phase 1; complete after core loop if time permits |

Phases 3 and 4 can be developed independently once their API contracts and project context are established. Finish the core loop before adding polish.

## 4. Implementation tasks

### Phase 1 — Shared API and access handling

**Work**

- Reuse or extend the shared API helper; keep API calls out of presentational components where practical.
- Send requests with `credentials: "same-origin"` and JSON content type for JSON mutations.
- Use opaque string IDs, exact backend enums, UTC ISO timestamps, and `YYYY-MM-DD` date fields.
- Show loading, empty, failure, and saving states on each API-driven view.
- Handle `401` by returning to sign-in; show restricted-action feedback for `403`.
- Handle `404` by refreshing project context and explaining that the record or access may no longer be available.
- Disable submission controls while requests are pending. Do not automatically retry mutations.
- Clear project-scoped state when switching projects or signing out.

**Acceptance criteria**

- Founder and employee sessions use their existing login flows.
- Session expiration produces a clear sign-in state.
- A failed request shows the backend error without losing an unsent draft.
- A double click does not create duplicate frontend requests.

### Phase 2 — Project, client, and workflow setup

**Work**

1. Allow project creation with a required name and optional client name.
2. Display the project as Setup until workflow start succeeds.
3. Add client assignment with client name and optional Telegram user ID. Explain that automatic Telegram capture needs an identified client; the backend may also resolve identity from the approved group roster.
4. Load workflow templates and show their stage previews.
5. Enable Start Workflow only after client assignment and template selection.
6. Submit workflow ID, optional start date, and optional assignee ID.
7. Refresh the project after starting; show current stage, progress, deadline, and generated tasks.
8. Disable client replacement and hide repeated-start controls after workflow start.
9. Avoid activating Setup projects through the existing status-edit form; workflow start is the activation action.

**API mapping**

| Action | Endpoint |
| --- | --- |
| Create project | `POST /api/founder/projects` |
| Assign client | `POST /api/founder/projects/:id/client` |
| Load templates | `GET /api/founder/workflows` |
| Start workflow | `POST /api/founder/projects/:id/workflow/start` |
| Load workspace | `GET /api/{founder|employee}/projects/:id/workspace` |

**Acceptance criteria**

- A project can exist before client assignment.
- Start remains unavailable until the client and workflow are selected.
- Starting produces the generated tasks and an active project view.
- A repeated submission does not display duplicate tasks.
- Existing project navigation and legacy project views remain usable.

### Phase 3 — Tasks and contextual discussion

**Work**

- Add a task list showing title, assignee, status, deadline, and stage.
- Add a task detail drawer/modal with description and its discussion thread.
- Let founders create tasks, assign/reassign owners, edit fields, cancel, and delete.
- Let an assignee update their task; hide reassignment from employees.
- Use these exact statuses: `Open`, `In progress`, `Blocked`, `Completed`, `Cancelled`.
- Display a Client request label and source-query link when `sourceQueryId` exists.
- Add message composition with optional HTTPS attachment reference.
- Display sender and timestamp; support paginated message loading.
- Use the returned message cursor for subsequent pages; reset it when changing threads.
- Disable replies on completed/cancelled tasks and show a reopen action to permitted users.
- Update the persistent read cursor only after the relevant messages are visible.
- Do not imply that read cursors provide a complete notification inbox; that aggregation is deferred.

**API mapping**

| Action | Endpoint |
| --- | --- |
| List tasks | `GET /api/{founder|employee}/projects/:id/tasks` |
| Create task | `POST /api/founder/projects/:id/tasks` |
| Read/update task | `GET/PATCH /api/{founder|employee}/tasks/:id` |
| Delete task | `DELETE /api/founder/tasks/:id` |
| Read discussion | `GET /api/{founder|employee}/tasks/:id/messages?after=<message-id>&limit=100` |
| Post message | `POST /api/{founder|employee}/tasks/:id/messages` |
| Mark messages read | `POST /api/{founder|employee}/tasks/:id/read` |

**Acceptance criteria**

- Task creation, assignment, updates, completion, cancellation, and deletion refresh correctly.
- A permitted employee can update their assigned task but cannot reassign it.
- Discussion stays attached to the selected task.
- A project switch cannot show another project's stale task/thread data.

### Phase 4 — Client-query inbox and attachments

**Work**

- Extend the existing founder inbox and add an employee inbox for assigned projects.
- Show client name, message, context, source timestamp where available, and query status.
- Show photo/file indicators and authenticated previews/downloads.
- Include loading and unavailable-media states.
- Show internal discussion separately from the final published response.
- Allow founders and assigned employees to post internal comments.
- Keep founder decision/publish controls hidden from employees.
- Preserve project context when opening a query from its inbox.

**API mapping**

| Action | Endpoint |
| --- | --- |
| Founder inbox | `GET /api/founder/decision-requests` |
| Employee inbox | `GET /api/employee/decision-requests` |
| Query detail | `GET /api/{founder|employee}/decision-requests/:id` |
| Internal comment | `POST /api/{founder|employee}/decision-requests/:id/comment` |
| Preview/download attachment | `GET /api/{founder|employee}/decision-requests/:id/attachments/:index` |

Use the authenticated attachment endpoint directly with same-origin cookies. Do not construct Telegram file URLs in the browser.

**Acceptance criteria**

- Assigned-client text and photos appear under the correct project after backend sync.
- Two staff users can discuss a query without publishing those comments to Telegram.
- Employees see only requests from their assigned projects.
- A failed attachment load does not prevent reading or discussing the query.

### Phase 5 — Query review and task conversion

**Work**

- Add founder actions for Approve, Reject, and Create Task.
- Require a rejection reason.
- For task conversion, collect title, assignee, and optional deadline/stage.
- Disable conversion when the workflow has not started; show the setup action.
- After conversion, replace Create Task with Open Linked Task.
- Preserve the original query and its comments in the interface.
- Treat decision state, task state, and delivery state as separate fields.

**API mapping**

| Action | Endpoint |
| --- | --- |
| Approve | `POST /api/founder/decision-requests/:id/approve` |
| Reject | `POST /api/founder/decision-requests/:id/reject` |
| Convert | `POST /api/founder/decision-requests/:id/convert` |

**Acceptance criteria**

- Rejection requires a reason and displays the saved decision.
- Conversion creates one traceable task, including after a retried request.
- Approving or converting never sends a Telegram message.
- Discussion remains accessible after the decision.

### Phase 6 — Publish final reply

**Work**

- Keep a dedicated final-reply composer, separate from internal comments.
- Before sending, show a confirmation with the destination project and exact reply text.
- Send `{ response, idempotencyKey }` to the existing Publish endpoint.
- Generate a key for each reply attempt and retain it for retries of the same reply. Generate a new key when editing a definitively failed reply.
- Prevent publishing while delivery is pending or uncertain, or after a successful reply.
- Show the saved published response and timestamp after success.
- Keep task completion independent from reply publishing.

**Endpoint**

`POST /api/founder/decision-requests/:id/publish`

| Delivery status | Required UI behavior |
| --- | --- |
| Sending | Show progress and disable Publish |
| Sent | Show the published response and prevent another send |
| Failed | Show the error; allow an explicit retry after correction |
| Unknown | Explain that delivery is uncertain, require checking Telegram, and block another send |

There is currently no reconciliation API for Unknown delivery. Flag it to the backend owner; do not invent a frontend reset or bypass.

**Acceptance criteria**

- A final reply reaches the dummy client's Telegram group after explicit confirmation.
- Clicking twice or retrying the same completed key does not produce two replies.
- Unknown delivery never triggers an automatic retry.
- Internal discussion is not included in the outgoing reply unless the founder explicitly writes it into the composer.

### Phase 7 — Refresh strategy and pilot verification

**Work**

- Poll active, visible project/query views every 5–8 seconds.
- Refresh immediately after a successful mutation.
- Stop polling when the tab is hidden, the user signs out, or the relevant view closes.
- Preserve unsent message/reply drafts during refresh.
- Ignore stale responses after switching projects or threads.
- Run the acceptance sequence below with the deployed services.

### Phase 8 — Access-management controls

**Work**

- Add founder-only Remove from Project and Disable Employee actions.
- Explain the effect in confirmation: project removal affects that project; account disablement ends all employee access.
- Refresh memberships and assignees after success.
- Remove inaccessible project context when subsequent requests report revoked access.

**API mapping**

- `DELETE /api/founder/projects/:id/members/:memberId`
- `POST /api/founder/employees/:employeeId/disable`

**Acceptance criteria**

- A removed member loses access to the project's tasks, queries, chat, and media.
- Other project access remains available after project-only removal.
- A disabled account cannot continue using its existing session.

## 5. Pilot acceptance checklist

Use one founder, one employee, and one dummy Telegram client.

- [ ] Create a project without a client; verify Setup state.
- [ ] Assign the client and select/start the web workflow.
- [ ] Confirm the backend owner has also completed bot client approval and bot workflow selection.
- [ ] Verify generated tasks, stage, and deadlines.
- [ ] Send Telegram text as the assigned client; verify the correct project receives it.
- [ ] Send a photo; verify its preview.
- [ ] Discuss the query as founder and employee.
- [ ] Convert it into a task; assign and update the task.
- [ ] Add a task-thread reply.
- [ ] Write, confirm, and publish a final reply.
- [ ] Verify receipt in Telegram.
- [ ] Refresh the browser; verify task, comments, and published response persist.
- [ ] Verify an unrelated employee cannot access the project.
- [ ] Verify removal/disablement revokes access.
- [ ] Exercise Failed/Unknown delivery states in a controlled test environment.
- [ ] Check the core loop on desktop and mobile without changing the design system.

## 6. Out of scope before the pilot

- Visual redesign or navigation overhaul.
- Google Drive integration and Drive permission synchronization.
- Advanced stage editing, dependencies, or parallel scheduling.
- Complete notification aggregation and unread-badge polish.
- AI summaries and activity dashboards.
- Cloud archival of Telegram attachments.
- New client web accounts.
- Backend implementation, database migration, or deployment changes.

## 7. Definition of done

The frontend implementation is pilot-ready when the deployed core loop passes with real Telegram text, photo, and reply delivery; both staff roles see the correct permitted actions; state survives refresh; and failures produce clear actionable UI states.

Offline backend tests or frontend mock screens alone do not satisfy this acceptance criterion. Record any remaining backend/deployment blocker separately, with the failing endpoint and observed response.
