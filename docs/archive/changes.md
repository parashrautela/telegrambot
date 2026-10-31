> Historical record. Use the current application README and architecture guide for setup and ownership.

# Changes

## 22 October 2026 — client review implementation

- Started `codex/client-review-fixes` in the production web checkout and the bot checkout, preserving existing work.
- Bot base: deployed `origin/main` (`2b17bc6`). Web base: `8966847`, whose committed tree matches deployed `a0f28c3`.
- Scope: all items in `docs/archive/client-review-status-priority-2026-10-22.md`, excluding Google sign-in.
- Baseline audit: 48 targeted tests and two empty-command assertions passed before implementation.
- Status: implementation underway. No new release deployed.

Entries below will record completed behavior, tests and remaining limitations as each batch is finished.

### Batch 1 — discovery and creation cleanup
- Added verified recovery of known Telegram users on group discovery/refresh and an explicit verify-by-ID flow for unknown existing members.
- Discovery records real message senders, excludes anonymous/bot senders, respects departures and avoids repeated unchanged Sheet writes.
- Refresh reports recorded people separately from Telegram account count; uses the actual bot username for `/join` guidance.
- Removed standalone project-creation buttons and duplicate Telegram sidebar navigation while retaining project setup access.
- Replaced the long joining-member TLDR with a short role-pending welcome.
- Validation: four discovery tests passed; frontend production build passed. Full integration checks are being updated for the new refresh behavior.

### Batch 2 — roles and daily operations
- Added backward-compatible multiple project roles and multiple client membership; founders can remain eligible for work, and shared role tasks are visible only to eligible project staff.
- Added Actions needed as the default founder page, with person/project/status filters and direct task opening. Added employee workload links and Designer/Supervisor views.
- Added supervisor replacement preview/apply with selected-project scope, stale preview protection, verified Telegram membership, transferred outstanding tasks and preserved completed history.
- Added personal Telegram connection via Start, editable morning digest settings (09:00 Asia/Kolkata default), empty-digest suppression and persisted send status. Uncertain sends are not retried automatically.
- Added concise task-based founder summaries.
- Validation: 52 web backend tests and 68 bot tests pass; production frontend build passes. New behavior is implemented locally, not deployed/live-accepted.

### Batch 3 — spaces, stage editing and reusable plans

- Added project spaces and optional room selection on stages, with distinct names for scoped rework and protection against deleting rooms still in use.
- Made all six standard task rows editable/removable. Zero-day rows are skipped; new task placement stays sequential, with project roles and a Founder assignee choice.
- Added stage connection editing in the timeline: drag handles or accessible selectors, parallel starts, multiple predecessors, cycle checks, preview/confirmation and protection for started work.
- Added shared saved plan templates that preserve task names, roles, durations and stage dependency branches. Template batches validate completely before saving; applicable destination spaces are retained.
- Made stage headers expand/collapse directly, with a separate edit action.

### Batch 4 — integration and browser acceptance

- Fixed initial-snapshot multi-client routing, departure access revocation and actionable validation errors in the new planning/operations routes.
- Added a shared decision lock so simultaneous decisions from the group and founder bots cannot apply the same approval twice.
- Supervisor replacement preserves a person's other roles and other colleagues' explicit assignments, while updating transferred task Telegram IDs and future routing.
- Added visible employee Telegram connection status. Digest delivery survives restart as Unknown rather than resending uncertain messages; large digests split into messages.
- Browser verified: default Actions needed and task opening; prerequisite completion guard; six editable task rows; selected rooms and Skip; stage save; connection preview/apply and persistence; supervisor preview/apply and replacement workload; digest schedule save.
- Fixed graph initialization and node visibility after saving connections, found during browser acceptance.
- Latest regression checkpoint: 84 web tests and 73 bot tests pass. Final build/release checks follow below.
- Google sign-in remains excluded. No new production deployment has occurred.

### Final validation and release status

- Final checks: **84 web tests + 75 bot tests = 159 passing tests**; production Vite build; bot syntax checks; both diffs pass `git diff --check`.
- Full implementation/acceptance matrix: `docs/archive/client-review-implementation-2026-10-22.md`.
- Added repository-local `changes.md`, `context.md` and the implementation report to both companion codebases for durable handoff.
- Rechecked Railway: production service explicitly reports **Limited Access — Deploys have been paused due to an upstream issue**. Release cannot proceed yet; bot must deploy before web. No production merge/deployment attempted while this gate is active.

- Final browser check confirms stage nodes remain visible after a three-link dependency save; saved screenshot at `/private/tmp/iksha-stage-connections.png`.

- Created and attached draft review PRs: bot #17 and web #28. Both report clean merge state; Vercel's web preview check succeeded. Production release remains pending Railway's deploy pause.

### Google sign-in added to scope

- User explicitly authorized Google sign-in and Console setup, superseding the earlier exclusion.
- Prepared Studio Iksha branding in the existing telegram-not-shii project. User approved the support/developer email and personally accepted Google's API user-data policy.
- Implemented verified Google identity, pending founder admission, existing-profile linking/project grants and explicit authenticated founder Google linking. Password login remains available.
- Added the official Google token verifier. Compatible existing build-tool security fixes leave npm audit at 0 vulnerabilities.
- Bot PR #17 merged as d3c08db; Railway accepted a new build and the previous deployment remains active while it builds.

- Bot rollout verified healthy: new PR #17 revision is ACTIVE in Railway and its public /health returns HTTP 200 with {ok:true}.
- User approved publishing the factual privacy page required for Google branding. Added /privacy for both Railway and Vercel, linked it from sign-in, and prepared the branding URL. Production Google client ID application was triggered.

### Production deployment and Google configuration complete

- Deployed bot #17 and web #28 successfully; live Google config is enabled through both production hosts.
- Created Google Web client, saved the user-approved privacy/homepage branding, and published Google audience to In production.
- Verified live Employees Google management and Continue with Google button while retaining the existing founder session.
- Awaiting the user's own founder Google account selection for the first live account-link/sign-in check.
- Final automated validation: 167 passing tests (92 web, 75 bot), production build passes, npm audit 0 vulnerabilities.

## Live Google identity check

The real Google sign-in created a Pending request for parashrautela70@gmail.com. A fresh Employees request refresh still shows Pending; founder linkage is not yet confirmed despite the user reporting success. The authenticated founder tab is Chrome 699941509, with Link my founder Google account expanded. The public welcome-page Google button creates a staff request; use the separate authenticated founder-link flow to grant founder access. Explicit action-time authorization or the user completing that flow is pending. Do not approve it as a new employee as a substitute.

## Google founder sign-in completed — 22 October 2026

- User explicitly approved linking parashrautela70@gmail.com as founder at action time. Completed the authenticated Employees → Link my founder Google account flow.
- Live UI confirmed “Founder Google sign-in linked: parashrautela70@gmail.com” and no pending Google access requests. Existing employee count remained 3; no duplicate staff profile was created.
- Signed out, then completed a fresh real Google sign-in without entering the founder key. The founder workspace opened, and Employees confirmed the linked identity.
- An initial browser challenge had expired while multiple app tabs were open; Try again issued a fresh challenge and sign-in succeeded. No change to production code was needed.
- Saved verification screenshot: /private/tmp/iksha-google-founder-verified.png. Google Cloud is In production, privacy page is live, both backend releases are ACTIVE.
- This supersedes the pending founder-link checkpoint above. Remaining live acceptance checks concern personal Telegram digests and native Telegram command interactions, not Google setup.

## Consistent dropdowns and expandable cards — 23 October 2026

User requested consistent styling for all dropdowns. Added shared controls.css for plain selects, NativeSelect, and dialog controls: matching heights, sage borders, white backgrounds, chevrons, hover/focus/disabled states, and a styled scrollable option card where the browser supports customizable selects. Browsers without support retain the native option picker. Mobile controls use 44px targets and 16px text.

Expandable sections (supervisor replacement, digest settings, Google founder link, project spaces, stage connections, plan templates, default stage options, and task resources) share whole-row headers, right-aligned rotating chevrons, open-state dividers and keyboard focus. Removed NativeSelect's width-constraining wrapper and duplicate icon so width/flex classes apply directly to the select. No behavior, permissions or records changed.

Validation: production build and git diff --check passed. Local browser verified option-card appearance, ArrowDown/Enter selection, expandable card body layout, and Add stage dialog select sizing. Saved screenshots /private/tmp/iksha-dropdown-menu-updated.png and /private/tmp/iksha-dropdown-cards-updated.png. Physical mobile/older-browser picker rendering has not been tested. Publication pending.

### Dropdown release verified

PR https://github.com/parashrautela/workflow-managment-/pull/29 merged. Production serves the shared dropdown stylesheet; live browser verified the styled Person option card and expandable supervisor card in the existing founder Google session. Proof: /private/tmp/iksha-live-dropdown-update.png and /private/tmp/iksha-live-disclosure-update.png. No production records were edited during UI checks.

## Google-only team access — 23 October 2026

User confirmed equal founder powers, immediate access for pre-added staff emails limited to assigned projects, and adding the second founder later. Implemented Google-only login in UI and API, removed password creation/reset and Telegram-generated web passwords, added explicit email pre-approval, unknown-account role/project review, equal founder invitation/promotion/removal and atomic role transfer. Last claimed founder is protected. Existing Google founder identity remains approved; migration removes old password hashes/key sessions and retains project/profile history. No real second founder or employee has been added for this release.

Frontend browser verified equal-founder panel and successful employee pre-approval in disposable local data. Automated verification covers real local RSA verification, forged/wrong tokens, nonce replay/concurrent use, email authority and exact matching, duplicate prevention, assigned-project privacy, role/session revocation, founder equality, unclaimed-successor guard, transfer and restart. All 96 web tests (including final duplicate-email checks), production build and whitespace checks passed. Source branch codex/google-only-team-access. See work/production-web/docs/google-sign-in-setup-2026-10-22.md for current setup and migration behavior. Production publication pending.

### Google-only release verified live

PR https://github.com/parashrautela/workflow-managment-/pull/30 merged as d0007331ce14a6a001a1b42f57280fa7a611dfbe. Vercel serves the new UI and the production API returns HTTP 410 for the former founder password login. Existing Google founder session survived the migration. A fresh real Google sign-out/sign-in as parashrautela70@gmail.com opened the founder workspace successfully. Live Employees → Founders shows Parash as connected, the last-founder removal button disabled, and the add-founder form ready. Existing counts remain 15 projects / 3 employee profiles. No real employee or second founder was created during verification.

Existing staff such as Ravi/Nishank need their exact Google sign-in email saved using Edit on their existing profile; this pre-approves the same employee ID and avoids duplicates. The second founder can be added later by name/email. Founder role transfer/removal and new-staff access were verified with isolated signed-token tests and disposable UI data; the second founder's real account and physical mobile remain untested. All 96 web tests and production build passed. Screenshots: /private/tmp/iksha-google-only-login-live.png and /private/tmp/iksha-google-only-founders-live.png.


## 2026-10-23 — project communication and meetings

User authorized the complete new transcript plan. Implementation underway; scope and acceptance are in work/production-web/docs/project-communication-plan-2026-10-23.md. Preserve existing profiles and project history. No real notification sends during development.


## 2026-10-24 — communication and meetings implementation complete

Implemented the six-part transcript plan: founder-only task mutations with project-wide staff reading/discussion; separate durable image/PDF attachments and reviewed Telegram sharing with selected tags; predecessor resource handoff; hold/resume queries and compact history with consistent unattended counts; task-linked meetings, IST reminders, attendee selection, edit/cancel and delivery history; internal project chat directory, city-grouped supervisor project selection, simplified client/location/spaces details, scalable task filters and an editable built-in Purchase template. Existing identities and history are retained. Removed the superseded standalone ProjectSpaces editor.

Verification: 107 web tests and 77 bot tests pass (184 total); web production build, bot syntax and whitespace checks pass. Browser demo used 120 tasks in a fake project, verified internal posting, reviewed sharing through a local mock bridge, hold removing the unattended query, meeting creation/delivery status, purchase preview/apply, details fields and city grouping. File signature, binary persistence and access revocation are covered by HTTP tests. The browser file-picker check outlasted its disposable session and is not counted as passed. No real notifications, staff changes or production records were used.

Publication pending. Ship the bot before the web app. New attachment bytes use an additive PostgreSQL table, separate from the workspace snapshot; local development uses the data file's adjacent .files directory. Real PostgreSQL deployment, native mobile and Telegram delivery acceptance remain. Bot calls/missed calls remain outside this release as agreed in the plan.


## 2026-10-24 — review branches published

Web implementation: 54eda04 on codex/project-communication-meetings, draft PR https://github.com/parashrautela/workflow-managment-/pull/31. Companion bot: 3f8c226 on codex/task-sharing-bridge, draft PR https://github.com/parashrautela/telegrambot/pull/18. Both are pushed and attached to this chat. Main/production remain unchanged. Deployment order is bot #18, then web #31. Final verification is 107 web tests + 77 bot tests (184 total), frontend build, bot syntax and whitespace checks. The final added safeguard excludes disabled/departed attendees even during grouped fallback. Real Telegram delivery, deployed PostgreSQL and physical mobile acceptance remain pending.


## 2026-10-24 — site admin personal reminders

Focused reminder fix; calling remains excluded. Fixed the daily sender overlooking a saved Telegram Start connection when the employee profile is created afterwards. Employee status, settings and delivery now recognize both saved connection records and legacy employee connection timestamps. Future work checks forecast, current and planned dates.

Added Actions needed → Morning digest settings controls to get/copy the bot link, show active staff connection status, preview one person's current task list and explicitly send today's real list before the scheduled time. Manual and automatic sends share the same daily delivery record; duplicate and uncertain sends are blocked. Send checkpoints preserve the attempt if persistence fails after Telegram delivery. No web login is required for the recipient.

Verification: 112 backend/frontend tests pass, production build, syntax and whitespace checks pass. Disposable browser demo verified copying the link, connected/waiting states, personal preview, mocked delivery history and disabled repeat send. No real staff received messages. Live acceptance requires choosing a site admin, their pressing Start, deployment and one confirmed delivery. These changes currently build on pending web PR #31; existing bot Start and personal-send endpoints are reused.


### Personal reminder publication checkpoint

Reminder-only local web branch: codex/site-admin-personal-reminders, commit c5c9cc2. All 112 backend/frontend tests and build pass; browser demo confirmed link copying, saved-connection recognition, task preview, mocked sending and repeat-send blocking. Screenshot: /private/tmp/iksha-personal-reminder-demo.png. Current source builds on pending web PR #31; bot #18 also remains a draft. No real messages sent and no production deployment performed.

Automatic approval review rejected git push / draft PR creation because explicit authorization to export this code to parashrautela/workflow-managment- was not established. User approval has been requested; do not retry publication until authorization arrives. Also awaiting the user's choice of site admin for the first live reminder. No calling work was done.


## 2026-10-25 — reminder draft published with user approval

User explicitly approved pushing the tested fix to parashrautela/workflow-managment- and opening a draft PR, superseding the earlier automatic publication block. Pushed local commit c5c9cc2 on codex/site-admin-personal-reminders. Draft PR: https://github.com/parashrautela/workflow-managment-/pull/32, based on codex/project-communication-meetings (pending draft PR #31). PR attached to chat. No merge or deployment performed.

User wants to use their own newly joined test profile in the Vikas Jewels Telegram group, and will assign its site admin/Site Supervisor role. Awaiting the exact project-team profile name and their pressing Start in the project bot. No real reminder sent yet. Keep calling out of scope. The new preview/manual-send controls require deployment before live UI testing; do not claim they are live.


## 2026-10-25 — restore revoked employee access

User requested a way to reactivate an existing revoked employee so the same Telegram account can be assigned Site Supervisor/Site Admin in the new test project. Added a founder-only Restore access button on revoked employee cards with an explicit confirmation dialog. POST /api/founder/employees/:id/enable reactivates the same employee; approved Google access and retained project memberships become available again. It preserves Telegram identity/Start connection and profile history, leaves Google approval status unchanged, does not resurrect revoked sessions or cleared task assignments, and records employee_enabled. Repeated restore requests are idempotent. Onboarding errors now direct founders to Employees for recovery.

Verification: 113 backend/frontend tests pass; production build, syntax and whitespace checks pass. New HTTP test reproduces the disabled Telegram assignment error, restores the account, confirms role assignment succeeds, checks the same employee ID/count and Telegram connection, fresh Google sign-in, old-session denial, non-founder denial, cleared assignments, restart persistence and audit entry. Disposable browser check confirmed the revoked card button, confirmation, refreshed active card and connected Telegram indicator. Screenshots: /private/tmp/iksha-restore-access-dialog.png and /private/tmp/iksha-restored-employee-demo.png. No real employee was reactivated and no real reminder was sent. Publication/deployment status must be checked separately.

Restore-access release checkpoint: a1e9e19 pushed to codex/site-admin-personal-reminders and included in draft PR #32 (title: Fix personal reminders and restore revoked employee access). All 113 tests/build pass. Production deployment remains pending; no real account restored and no real message sent.


## 2026-10-25 — compact sidebar navigation and production release correction

User requested workspace navigation as a dropdown to leave more room for projects. Replaced the nine persistent navigation buttons with the existing NativeSelect control labelled Workspace section. It displays the current section and counts, retains every destination and the existing navigation/loading/mobile-close behavior, and leaves Quick Projects directly available below. No dependency or backend change. Build and whitespace checks pass. Disposable browser with 16 fake projects verified all menu items, section selection, quick-project navigation and keyboard ArrowDown/Enter. Screenshot: /private/tmp/iksha-sidebar-dropdown-demo.png. Physical mobile not checked.

Release finding: user merged #31 into main, then #32 into codex/project-communication-meetings, so #32 did not reach main. Created corrective PR #34 from the already tested reminder branch into main and merged it as d3bab38c9b6fbf3bce404232a161d0dd36d25299. GitHub reports both Vercel Production (deployment 7304010169) and Railway giving-smile/production (7304009047) succeeded. Created and closed redundant restore-only PR #33 without merging. Reminder/Restore release is now deployed; live Employees UI verification is underway. No real employee reactivated or reminder sent by the agent.

Production verified after corrective PR #34: refreshed live Chrome tab 699941861 → Employees shows revoked Parash EMP-18ED52D01D with Restore access. Both Vercel and Railway deployments report success. Screenshot /private/tmp/iksha-restore-access-live.png. No real profile restored. Sidebar UI is separately in PR #35 on codex/sidebar-workspace-dropdown, final head 343b8d2; browser verified section selection, keyboard and returning from project details to All Projects.

Sidebar release: PR #35 merged as 6568202f5aa743390f3ac14b2197699eae254d9d. Vercel Production deployment 7304064959 reports success; Railway giving-smile/production deployment 7304064376 is being checked. No actual staff permission changes or messages were performed. Final production UI verification is underway. PR #33 was closed and unlinked as redundant.

Final live UI verification: production Chrome tab 699941861 has the compact Workspace dropdown, 16-project list with substantially more visible rows, and Employees → Parash EMP-18ED52D01D → Restore access. Screenshot /private/tmp/iksha-dropdown-restore-live.png. The profile remains revoked because the user is to confirm restoration; no staff permissions changed and no Telegram reminder sent. User should refresh and choose Employees in the new dropdown. Original DM test remains pending their role assignment and Start in the project bot.


## 2026-10-25 — editable personal reminder preview

User explicitly requested that Preview today's reminder be editable before sending to Parash. Replaced the read-only preview with the existing Textarea control and send the reviewed text as optional POST personal-reminder.text. Backend validates nonblank text up to 12,000 UTF-16 code units, sends and stores that exact text for the selected employee, safely chunks long lines/Unicode, and returns the recorded text when revisiting a completed/uncertain delivery. Founder/active/Start checks and daily duplicate protection remain. A different draft submitted after today's attempt returns 409; identical retry returns the prior delivery. Edits affect only the explicit manual send; later automatic days still generate current task lists. An explicit custom note may be sent with no actionable tasks, allowing the user to test their own connection without changing task dates; automatic empty digests remain suppressed.

Verification: 116 backend/frontend tests pass, production build and whitespace checks pass. Tests cover exact text and recipient, invalid drafts, manual notes with no due tasks, Unicode chunking, recorded message preview, idempotency, changed-after-send rejection and future automatic messages. Disposable browser with fake staff verified typing, blank-draft send prevention, mock send and read-only recorded message after delivery. Mock capture: /private/tmp/iksha-edited-reminder-sends.jsonl. No live staff reminders were sent. User wants to operate the live flow themselves while the agent guides them; do not click live Start or send personal messages on their behalf.

Editable reminder release checkpoint: PR #36 merged into main as c8e0ae4c4de4a269021a6bbbdcf714fafdbc2cd8 (source 59ecfc3 on codex/editable-personal-reminders). All 116 tests/build pass. Deployment verification pending. User explicitly requested guidance-only for the live notification test; local mock UI alone was operated and no Telegram message was sent to real staff.

Editable reminder deployment confirmed: Vercel Production 7304309861 and Railway giving-smile/production 7304309467 both report success for c8e0ae4. No live UI send or Start action performed. User next steps: refresh app → Actions needed → Morning digest settings → Parash Preview today’s reminder → edit Message to Parash → user chooses Send reminder. Edits apply to the manual send only and count as today’s daily reminder.


2026-10-25 timeline release: implemented Move in parallel and Shift everything after it, with explicit connection-change preview and stale-preview fingerprint. Shift follows task sequence in either direction; parallel leaves all other dates unchanged. Started/completed work protected; baseline dates preserved. Connection-changing moves have no Undo. Isolated unrelated concurrent client-query edits in /private/tmp/iksha-timeline-release. All 124 web + 81 bot tests pass and production build passes. Disposable browser test saved a Planning shift and verified Design shifts while Discovery stays fixed. Screenshot /private/tmp/iksha-timeline-move-options.png. Bot PR19 merged dd0e12b; Railway deployment7315825250 is in_progress. Web PR37 head09c8e99 preview succeeded, pending scheduler rollout before merge. No live project dates changed or Telegram messages sent.

Timeline release verified live: bot PR19 merged dd0e12b (Railway7315825250 success). Web PR37 merged34749e8 (Vercel7315840147 and Railway7315839450 success). Public app.js contains both move choices and connection preview. Final checks124 web +81 bot tests, build and disposable UI save. User should refresh and test their own live move; agent left live schedules untouched.


## 2026-10-25 — group context and query decisions released

User explicitly requested production publication. Built isolated release checkouts from current main at /private/tmp/iksha-query-production-web and /private/tmp/iksha-query-production-bot, excluding concurrent unrelated local chat/timeline edits. Web PR #39 (source 7355f27) merged as 4d61cf594c06dc901d087b01e3a5736abe198b3c. Vercel Production deployment 7315903584 and Railway giving-smile/production deployment 7315902847 both success. Bot PR #20 (source c547976) merged as 9f15906f82a19f6e490a114fcbf4108a8e13b31c; Railway proud-contentment/production deployment 7315919994 success. Both PRs attached to this chat.

New human group messages now sync to Queries; active assigned-client messages remain queries, others are Group message context without pending-work counts/actions. Bot keeps current multi-client membership checks, durable deduplication and retries. Only assigned-client queries allow rejection; reason optional with a default reply. Waiting for more context replaces Hold and is the fourth Accept action beside Delay, Redo and Mark complete; it reuses the hold endpoint, preserves task dates/status and remains waiting after a clarification reply. Old history is retained but ordinary messages from before deployment cannot be backfilled.

Verification: clean release 127 web + 82 bot tests, engine check and production build pass. Main advanced concurrently with chat-member PR #38; rebuilding merged main produced no asset changes and all 130 merged web tests passed. Public production app.js contains the group-context heading and new decision wording. Read-only live Chrome tab 699942286 → Vikas Jewels → Client queries shows Telegram Queries & Group Chat, Waiting for more context and Reject only for Krisha client messages; Nishank/Gousic messages have no Reject. No production query was accepted, held, rejected or sent; no test Telegram message was posted. Group capture live delivery still needs a new human group message. Local shared checkouts retain their unrelated uncommitted work; the production bot changes differ from the old root copy because current-main membership safeguards were preserved.


## 2026-10-25 — chat UI and decision notifications deployed

User explicitly authorized deployment and requested immediate push. Released only this chat's changes from clean current-main checkouts, preserving other local work. Bot PR https://github.com/parashrautela/telegrambot/pull/21 merged as 1ab1d08f54f7bc092764e88de5d5bf826e32b8a3; Railway production deployment 7316118434 succeeded before web merge. Web PR https://github.com/parashrautela/workflow-managment-/pull/40 merged as 3561205d047d454ee706b022c29d786a09becf62; Vercel production 7316133230 and Railway giving-smile production 7316132619 both succeeded. Release checkouts: /private/tmp/iksha-query-bot-release and /private/tmp/iksha-chat-ui-release. Clean-main validation: 133 web + 84 bot tests (217), frontend production build, whitespace checks. Verified live app.js contains task-thread-dialog, reviewed Telegram button, Sender updated in Telegram, and no standalone setHoldOpen(true); production auth config API responds enabled=true. No live query action or Telegram message sent. Both PRs attached to chat. User should refresh https://workflow-managment-ebon.vercel.app.


## 2026-10-26 — live group capture confirmed from phone

User sent capture-check-1026 directly to Vikas Jewels from their phone. Read-only Sheets inspection confirms REQ--5590585976-205-message, ProjectID P009, RequestType Message, OriginalSenderName Parash Rautela, CreatedAt 2026-10-26T05:43:06.000Z (11:13:06 IST), WebSyncStatus Synced. Earlier Hii sir how are you also exists as REQ--5590585976-204-message, 05:39:05Z, Message, Synced. This proves new ordinary non-client phone messages are persisted and acknowledged by the production web intake. Existing pending query badge remains 4 by design, because ordinary Group message context is excluded.

Earlier diagnostic release in this chat: web PR41 (9cc15ae) merged376daad27304bd2cdf187cdd6081f03f5a03b19c, Railway7316196142 and Vercel7316196769 deployed. Founder-only GET /api/founder/telegram-groups/:id/connection uses existing bridge to verify live group access. Live check confirmed Ikshagroup123_bot is an admin of -5590585976 with5 members; no permission changes made.134 tests passed. This diagnostic alone did not establish capture success; the user's fresh phone messages above now do.

UI rendering acceptance remains limited: new Chrome verification tab699942462 opened the signed-out Google login page, so no claim of visually observing the two new cards. No need for user Telegram access: native controls failed and Telegram Web required login. User had authorized one exact test message but agent never sent it; user sent tests from phone instead. Do not ask them to log in to Telegram for further checks. If their already-open app still omits these records, inspect its authenticated Queries response and filtering; receipt and backend sync are proven. Earlier Yooo at25 Oct21:56 predates capture deployment22:01 and cannot backfill through Bot API.


## 2026-10-26 — both decision buttons for every incoming sender

User first asked why ordinary Group message cards lacked controls, then explicitly clarified: both Accept and Reject are required on every query. This latest instruction supersedes the earlier client-only rejection rule. Released Accept support in PR42 (895b601), merge f35f5e51a465d0647bd2369f769fa1cce80d3d5c, then the updated all-sender decision rule in PR43 (26f3b3c), merge774f194dbdcbd762caf1dba1c4acbf11cf16b84b. Both PRs attached to this chat. Vercel production7325081254 and Railway giving-smile production7325080699 report success for final merge774f194.

Founders now see Accept and Reject on every undecided ordinary group message or explicit query regardless of sender role. Group messages can use the existing stage/task/action wizard, defaulting to Just attach, with Waiting for more context supported while preserving task dates/status. API accepts group-message decisions, and rejection retains optional default reply. All actions remain founder-only with project-access and existing closed-request checks. Ordinary chat continues to be excluded from pending attention counts. Existing API canReject response flag is retained as true for compatibility. Do not restore the superseded client-only filter unless user requests it.

Validation:137 backend/frontend tests pass, production build and whitespace/syntax checks pass. Added preview/accept/hold/resume/reject, task-link deduplication, founder permission and restart evidence retention coverage. Live authenticated Chrome tab699942466 refreshed, Vikas Jewels→Client queries verified Accept and Reject directly below capture-check-1026 and Hii sir how are you, and on Krisha/Nishank/Gousic undecided cards. All11tasks and4pendingqueries remain. No production decision was submitted and no Telegram message sent by the agent. Release checkout /private/tmp/iksha-query-production-web on codex/query-decisions-for-everyone; shared original source remains uncommitted and includes unrelated work.
