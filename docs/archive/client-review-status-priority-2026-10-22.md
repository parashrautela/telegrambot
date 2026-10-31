> Historical record. Use the current application README and architecture guide for setup and ownership.

# Studio Iksha — current status and priority

Reviewed 22 October 2026 against the call's 15 deliverables. This is an audit, not a new implementation.

## Evidence and status rules

- The successful production web deployment uses commit `a0f28c3`. Its committed source tree is identical to this checkout's `8966847` tree (`32e991bf2ec7f1b304581ad02610a5241d04baf6`). Commit histories differ; the checked-in files match.
- The bot's deployed release observed in Railway is `2b17bc6`, also the current remote main. Bot checks below used an isolated copy of that revision.
- Uncommitted Telegram discovery/help-text changes are local only. The live Vikas Jewels roster repair is a separate, completed data repair.
- 25 existing web tests and 23 bot tests passed. Two additional read-only assertions confirmed that empty `/query` and `/update` commands are rejected. These checks do not replace live desktop/mobile acceptance testing of every flow.
- **Present** means the specific capability is implemented in the reviewed source. **Partial** means a usable foundation exists but part of the client's requested behavior is missing. **Missing** means no working implementation was found in the inspected app/bot paths. Priority is a recommendation based on correctness, daily use and the client's emphasis.

## Already present — retain and reuse

| Capability | What exists | Evidence |
|---|---|---|
| Telegram-linked setup | Group discovery, roster snapshot/refresh, profile/role saving, project name/start date and setup completion | `frontend/src/features/telegram/TelegramGroups.jsx`, `backend/server.js`, bot `src/index.js` |
| Standard six-task stages | Site Condition Check → Drawing → Drawing approval → Client Presentation & approval → Site Execution → Final check; default roles and durations | `frontend/src/features/timeline/lib/stageTemplate.js`, bot `src/stage-plan.js` |
| Skip a standard task | Zero means Skip; skipped tasks are omitted and the surrounding tasks are linked | `stageTemplate.js`, `stage-plan.js`, existing stage-plan tests |
| Blank custom projects | Start with no generated stages or tasks, then add custom work | `backend/tasks/pilot.js`, `WorkflowTemplateModal.jsx`, existing stage-flow tests |
| Custom task creation/editing | Custom task names, roles, durations, named people; add/remove rows during custom stage creation and edit timeline tasks afterward | `AddStageForm.jsx`, `EditTimelineTaskDialog.jsx` |
| Sequential task insertion | Insert a task between existing tasks and move following work appropriately | `InsertTaskDialog.jsx`, bot `stage-plan.js`, existing insertion tests |
| Basic stage placement | Start after another stage, alongside one stage or on a date | `AddStageForm.jsx`, `stage-plan.js`, existing placement tests |
| Timeline planning | Stage/task movement, task duration edits, schedule preview and confirmation, stage expand/collapse | `ProjectTimeline.jsx`, schedule routes and tests |
| Dependency inspection | A separate, read-only task graph; it does not support making new connections | `ProjectDependencyGraph.jsx` explicitly sets `nodesConnectable={false}` |
| Employee account controls | Add/link employees to projects, edit profiles, set/reset passwords, disable access | `EmployeeManager.jsx`, employee routes and integration tests |
| Employee project access | Staff access is checked against project membership, and task updates require assignee/founder rights | `backend/tasks/pilot.js`, employee integration tests |
| Query/update handling | Tagged text, replies and attachments, persistence, deduplication and retry; bare commands produce guidance instead of an empty request | Bot `decision-requests.js` and its tests |
| Query decision inbox | Existing Needs attention page lists decision requests with project/status filters, discussion and decision actions | `DecisionInbox.jsx` |

These completed capabilities should not be estimated or rebuilt as new features. They do not mean the larger bundled deliverables below are complete.

## P0 — fix before relying on the requested real-project flow

| Scope | Current status | Specific work remaining | Acceptance |
|---|---|---|---|
| D01: onboarding reliability | Partial; Vikas Jewels alone repaired live | Deliver a supported recovery path for people already present when the bot discovers a group. Correct refresh/completeness messaging and verify the fresh-group scenario. Local message-discovery changes are not deployed and cannot enumerate silent unknown members. | Recreate the group with bot and people together; register the expected people without developer data repair, with honest incomplete-roster guidance where needed. |
| D03: multiple roles and clients | Missing as a complete feature | Replace the single-role model with real project role membership; allow multiple Clients; update setup gates and downstream client routing. A comma in a role text field is not equivalent. | Founder + Designer on one person, two Founders and several Clients work across setup and task/query routing. |
| D04: founder/task approval routing | Partial | Existing role matching assigns only when exactly one member matches. Founder/Client profiles are excluded from normal staff binding, while approval routing still has a single leader identity. Add correct founder eligibility, responsibility versus approval and multi-person role handling. | Either eligible Founder can approve once; a Founder can do assigned work without losing founder access. Define who owns work when several people share its role. |
| D02: prevent accidental unlinked projects | Removal not done | Remove the header New project button, Quick Projects plus and floating New project action. Keep the Telegram setup entry point. Review the standalone create route separately if Telegram-only creation is an enforced product rule. | The normal homepage navigation cannot accidentally create an unlinked web project. |

The first three are correctness and data-model work. The project-create cleanup is a small change that can ship alongside them.

## P1 — daily operations and the client's major requests

| Scope | Current status | Specific work remaining | Acceptance |
|---|---|---|---|
| D09: daily Actions needed queue | Partial foundation | Needs attention currently lists queries/decisions, not the requested cross-project task/approval work queue. Add default-to-me, person/project/status filters and direct task opening. | Open the page and see Project → Stage → Task + status; change person and act on the exact task. |
| D11: employee workload views | Partial | Account administration and project access exist. Designer/Supervisor views and selectable cross-project workload lists are missing. Do not equate project-level access with an own-work-only view. | A founder sees an employee's outstanding work; restricted staff cannot read other employees' restricted workloads. |
| D12: supervisor replacement | Missing | Add replacement across selected projects, including outstanding assignments and future routing, with affected-project preview and retained completed history. | Replace the supervisor on three selected projects without changing unrelated projects. |
| D13: private morning digests | Missing | Add employee Telegram connection status, recipient scheduling, per-person task selection, delivery handling and recipient updates after replacement. Existing founder notifications are not personal scheduled digests. | Connected staff receive their own current work across relevant projects; the replacement receives transferred work. |
| D08: project spaces | Missing | Project space list, optional multi-select on stages, all-project default and distinct scoped rework stages. No matching space data model or controls were found. | Painting for Living room + Kitchen is distinguishable from Painting for Bedrooms and later Living room rework. |
| D07: stage connection editing | Partial | Reuse stage placement, collapse/movement and scheduling. Add connection editing on collapsed stages in the timeline, including multiple incoming/outgoing stage links. The separate task graph is read-only; moving dates does not itself define new dependency relationships. | A and B run in parallel; C waits for both; links remain visible and persist while stages are collapsed. |
| D06: sequential task workflow | Partial | Existing insertion works, but the live-source forms still offer parallel task placement and an Add a parallel task action, contrary to the client's requested within-stage sequence. Simplify to After which task and make completed-prefix setup wording clear. | New stage tasks stay sequential; inserting B between A and C produces A → B → C without unwanted parallel options. |

Recommended order inside this group: daily queue + employee views; supervisor transfer; digests. Spaces and stage connections can be scoped independently, but both were explicit client priorities.

## P2 — finish existing features and reduce UI/message friction

| Scope | Current status | Specific work remaining | Acceptance |
|---|---|---|---|
| D05: editable standard stages | Partial; substantial core exists | Keep the existing six defaults and Skip behavior. Standard-stage rows still use fixed titles and mostly fixed roles; fully custom mode starts with one blank row. Make the standard six directly editable/removable as requested and offer project-assigned role choices. Remove Fill from default plan if following the call's final UI direction. | Start from the six defaults, edit a name/role, remove a task and save without rebuilding the stage from blank custom rows. |
| D04: wording and selectors | Not finished | Owner still appears in the custom stage form. Role inputs are free text or generic suggestions rather than consistently drawn from assigned project roles. | Consistent Assignee wording; distinct work/approval responsibility; relevant project role options. |
| D06: validation display | Partial | A custom task error can currently make the stage-name field red because `stageNameProblem` combines name and task validation and its result drives that field's `aria-invalid`. Attach validation to the actual invalid field. | A valid stage name is not flagged because a task below it is incomplete. |
| D07: collapse interaction | Partial | Expand/collapse exists, but the founder stage header opens an action menu. Make the requested simple disclosure interaction clear without losing edit actions. | A user can expand/collapse directly and predictably. |
| D10: short assistant answers | Requested format missing; assistant exists | Current summary includes Client, Location, Recent work, Next milestone, Blocker and Team. Replace the default pending-work answer with compact Project — Stage — Task + status entries. | A many-project pending-work answer is short and grounded in actual tasks. |
| D14: concise bot messages | Not finished | The joining-member message still includes the long project TLDR. Shorten welcomes and routine confirmations. Keep the existing command parser/retry behavior. | New members receive a concise welcome/role-pending message; useful confirmations remain. |
| D14: command usability | Core validation already present; live UX unverified | Bare command rejection is implemented and checked. Verify the desktop/mobile send-versus-insert interaction and guidance. Do not report the entire command feature as missing. | Bare commands do not create requests, and people can reliably add content on supported clients. |
| D02: duplicate Telegram navigation | Removal not done | The Telegram groups sidebar entry remains. Remove the duplicate entry identified in the call while preserving required setup access elsewhere. | One understandable communication/setup path without a dead-end onboarding flow. |
| D05: reusable custom templates | Not confirmed | Predefined templates exist, plus legacy browser-local workflow helpers. No confirmed shared save-a-custom-plan-as-a-reusable-template flow was found. Clarify and verify before calling this done. | A saved custom plan can be selected for a new project from the intended account/device context. |

## P3 — defer until the operating workflow is settled

| Scope | Current status | Work remaining |
|---|---|---|
| D15: Google sign-in and founder admission | Missing | Current sign-in uses a founder key or employee ID/password. Implement Google identity linking, duplicate-account handling, pending admission and project grants when this becomes the priority. |

## Decisions that affect scope

1. Multiple Clients: any-client approval or a designated approver?
2. Multiple people with one execution role: one named assignee, claimable work or a shared queue?
3. Digests: time/timezone, weekends, blocked/future work and empty-day behavior?
4. Stage connections: supported overlap rules and the actual connection gesture?
5. Custom templates: shared persistence and explicit versus automatic saving?

## Practical next batch

Finish the permanent onboarding flow, role/client eligibility and creation-path cleanup first. Then build the shared daily work queue and employee workload view; reuse those task selections for supervisor replacement and digests. Do not spend a new feature budget recreating the six-task template, Skip, blank plans, insertion, basic parallel-stage placement or account controls.

Not checked: full live acceptance of every item, every user permission combination, or native Telegram client behavior after deployment. No application source or production configuration was changed during this audit.
