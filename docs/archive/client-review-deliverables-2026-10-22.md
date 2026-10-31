> Historical record. Use the current application README and architecture guide for setup and ownership.

# Studio Iksha — deliverables from the client review

Source: the supplied Gousic–Parash call transcript, reviewed on 22 October 2026.

This is a scope and acceptance checklist, not an implementation or deployment report. Priorities and delivery order below are recommendations. Statements made during the call that something is already built still need verification.

## Product outcome

Gousic and Nishank can open the app, see whose work needs attention, open the relevant task, and manage a project through a small number of stages. Designers and supervisors receive their own work. Telegram remains the client/group communication channel and sends only useful, concise messages.

## Deliverables

### D01 — Reliable Telegram project onboarding

- A Telegram group with the project bot becomes one project awaiting setup.
- Cover both joining an existing group and creating a group with the bot and people together; cover members added later.
- Refresh must distinguish recorded members from complete group membership. It must not claim to fetch everyone when discovery is incomplete.
- Provide a supported way to register existing members whom the Bot API cannot enumerate; verify known users against actual group membership before importing them.
- Keep project name, start date, member names and role assignment in the setup flow.

**Acceptance:** Repeat the Vikas Jewels scenario from a fresh group. Every expected person can be registered through the supported flow, duplicate projects/members are not created, and an incomplete roster is explained accurately.

**Current evidence:** Vikas Jewels was repaired manually in this chat. That does not establish that future groups are fixed automatically.

### D02 — One project creation path and one communication channel

- Remove the homepage/header action that creates a standalone web project.
- Keep Telegram-discovered projects and their web setup accessible.
- Remove the duplicate Telegram/chat navigation identified in the call so people do not split conversations across two places.

**Acceptance:** A user cannot accidentally create an unlinked project from the homepage; the Telegram onboarding flow remains usable. Removing duplicate navigation does not remove member setup or the Telegram integration.

### D03 — Multiple project roles and multiple clients

- One person can hold multiple roles in one project, such as Founder + Designer or Designer + Supervisor.
- Multiple people can hold the same role, including Founder and Client.
- Replace the existing exactly-one-client setup restriction with support for multiple clients.

**Acceptance:** Gousic can remain a Founder and perform design tasks; Gousic and Nishank can both be Founders; three family members can all be Clients. Setup and downstream query/approval flows handle those memberships consistently.

**Decision needed:** Whether any Client can approve client work or a designated client must approve it was not settled.

### D04 — Role-based task responsibility and approval

- Rename ambiguous task “Owner” labels to “Assignee”.
- In stage/task setup, offer roles currently assigned in that project rather than requiring repeated person-name entry.
- Keep who does the work separate from who approves it.
- A Founder can be assigned work too.
- An approval assigned to Founder can be completed by either eligible Founder.
- Allow the actual trade role, such as Carpenter or Painter, instead of forcing a generic Site team role.

**Acceptance:** A Founder approval appears for both eligible founders; one approval completes it without requiring both. A Founder can also be a task assignee. The UI clearly distinguishes responsibility from approval.

**Decision needed:** How execution work is claimed or assigned when several people share the responsible role.

### D05 — Prefilled, editable stage tasks

- Opening Add stage offers the existing six-step Studio task sequence, with its task roles prefilled.
- Allow editing names, roles and durations, removing unnecessary tasks, and adding another task.
- Keep the familiar default order; stage creation should not require typing the same six tasks repeatedly.
- Support skipping a template task; the call proposed `0` as the skip interaction.
- A new custom project starts with no stages/tasks until the user adds them.
- Keep stage names manually editable; remove the extra “Choose from default plan” selector discussed in the call.
- Verify the existing reusable-template flow rather than treating it as entirely new functionality.

**Acceptance:** Add Painting, retain the existing standard sequence, adjust durations, remove two tasks, and save the remaining tasks in order. A skipped step does not remain as an active zero-day task. A blank custom project stays blank.

**Decision needed:** Confirm exact default task names, roles and durations against the Studio template/Sheet; the transcript does not enumerate all six reliably. Confirm whether custom plans are saved automatically or through an explicit Save template action.

### D06 — Simple sequential task insertion and clear forms

- Tasks within a stage run sequentially.
- Add task asks “After which task?” and lists the stage's existing tasks, with a clear first-task option where needed.
- Remove task-level parallel-placement choices from this workflow.
- Existing stage tasks can be edited or removed without unnecessary setup steps.
- Fix unexplained red validation states; show the actual invalid field and reason.
- Make any “already finished” choice understandable for a project being entered midway through its execution.

**Acceptance:** Insert B between A and C; the order and dependency chain become A → B → C. The task does not run in parallel accidentally. Valid input is accepted, and invalid input has a specific explanation.

### D07 — Manage stage dependencies directly in the timeline

- Make each stage header easy to expand/collapse.
- Show stage dependency connections while stages are collapsed, in the same timeline used for planning.
- Allow a stage to start after another stage or alongside it.
- Allow multiple incoming dependencies: C waits for both A and B.
- Allow multiple outgoing dependencies from a stage.
- When moving a stage changes its relationship to other stages, offer a clear confirmation and update the actual schedule/dependencies together.
- Keep task internals sequential; users should not have to expand hundreds of tasks or switch to a separate task graph to manage stage flow.

**Acceptance:** Set A and B to run in parallel and C to start only after both finish. Delay either predecessor; C responds correctly. Connections remain visible with every stage collapsed. Reopening the project preserves the relationships.

**Decision needed:** The exact wire-drag gesture and supported overlap rules. Control/Shift interactions were examples from Grasshopper, not a finalized interaction specification.

### D08 — Project spaces and optional stage space selection

- Maintain a project-level list of named spaces, such as Living room, Kitchen, Bedroom 1 and Bedroom 2.
- Add a Spaces field to stages, allowing one or several spaces.
- No selected spaces means the whole project.
- Show spaces alongside the stage name so Painting — Living room is distinguishable from Painting — Kitchen.
- Support a later repair/rework stage for a specific space without reopening or replacing the completed overall stage.

**Acceptance:** Add Painting for Living room + Kitchen, another Painting stage for Bedrooms, and a later Living room repair stage. Each is distinguishable and keeps its own progress. Space selection is optional.

### D09 — Actions needed as the daily work queue

- Automatically list pending work and approvals without requiring a chat prompt.
- Default the person filter to the signed-in user.
- Let founders filter by person, project/all projects and work status, including pending approvals and overdue/urgent work.
- Each entry shows Project — Stage — Task, with status underneath.
- Selecting an entry opens the relevant task or approval so the user can act immediately.

**Acceptance:** Gousic sees his pending items on opening the page, switches to Nishank, filters to one project and opens an approval directly. Resolved work updates the list after the action.

### D10 — Short founder-assistant summaries

- Respond to work-status questions with compact Project — Stage — Task entries and status.
- Omit routine location, milestone and long project descriptions from this default summary.
- Keep the main action workflow in Actions needed. The later discussion moved away from requiring interactive chat cards.

**Acceptance:** A question about pending work across many projects produces a scannable list rather than a paragraph for every project, using the actual saved task state.

### D11 — Employee workload views and access

- Provide Designers and Site supervisors views within Employees.
- Founders can select an employee and see their assigned pending/current work across relevant projects.
- Staff with restricted access see their permitted work rather than everyone else's.
- Retain employee account administration where already available.

**Acceptance:** Founders can inspect a supervisor's work without calling them. A restricted designer cannot obtain another employee's workload through either the UI or API.

### D12 — Replace a supervisor across selected projects

- Assign one supervisor to several selected projects; location helps identify the intended group of projects.
- Offer Replace supervisor, selecting the departing person, replacement and affected projects.
- Transfer the relevant outstanding responsibilities in one operation instead of editing every task manually.

**Acceptance:** Replace Parash with Nishank on three Nellore projects. Outstanding supervisor work and future routing in those projects move to Nishank; Bengaluru projects are unaffected.

**Proposed guardrails:** Preview affected work before applying; retain completed-work history; handle the old person's project access explicitly. These details are recommendations, not settled call requirements.

### D13 — Private morning task digests

- Designers and supervisors can complete a one-time Telegram connection/start step.
- Send each connected recipient a concise morning list of their pending work across assigned projects.
- Supervisors can use this without opening the web app.
- Supervisor replacement updates who receives the relevant work.

**Acceptance:** Two people receive different personal digests containing their own work. A replacement supervisor receives the transferred responsibilities after connecting. Failed delivery is visible to the founder.

**Decision needed:** Delivery time/timezone, weekends, treatment of blocked/future tasks and whether an empty digest is suppressed. Separate bots per employee are not required by the product request.

### D14 — Concise Telegram messages and robust commands

- Replace long joining-member TLDR messages with a brief welcome/role-pending message.
- Keep routine bot confirmations and announcements short and relevant.
- Preserve useful `/query` and `/update` routing.
- Selecting/sending a bare command must not create an empty or bogus request; provide a clear next step to enter content.
- Verify command use on Telegram desktop and mobile without depending on the presence of a particular autocomplete arrow.

**Acceptance:** A joining member gets no long project history dump. Bare `/query` and `/update` commands create no request. Commands with real content reach the correct category. Ordinary group conversation is not accidentally stored as a tagged request.

### D15 — Google sign-in with founder-controlled admission

- Add Google sign-in for staff profile creation.
- New profiles await founder approval before gaining project access.
- Founders can approve/reject requests and assign approved people to projects.
- Link identities consistently to avoid duplicate staff records.

**Acceptance:** A first-time Google user cannot see project data before approval. Repeated sign-in reuses the same profile. A founder can approve the user and grant only the intended project access.

**Recommended priority:** After the core workflow changes. The call accepted the idea but emphasized supervision, spaces and stage planning more strongly. A company-email-domain restriction was a future possibility, not an agreed requirement.

## Recommended delivery order

1. **Correctness and onboarding:** D01–D04, plus the empty-command fix in D14.
2. **Daily work and supervision:** D09–D13. Agree on role routing before supervisor transfer and digests.
3. **Stage planning:** D05–D08. Keep the existing scheduling engine and UI consistent.
4. **Remaining simplification and sign-in:** the rest of D14 and D15; small copy/navigation improvements can ship earlier.

The client explicitly called supervisor handling and project spaces major items. Neither should disappear into a general “UI cleanup” ticket.

## Scope exclusions

The competitor walkthrough was context, not a request to build material inventory, purchasing, profit/finance tracking, labor management, AI renders, photo transformations, voice-to-task conversion or a native mobile app. A profanity test in the conversation was not an agreed feature request. Do not turn the external platform/security discussion into a confirmed cause of the member-discovery bug.

## Release acceptance scenario

Create a Telegram-linked project; register its people; give one person Founder + Designer roles and several people Client roles; add named spaces; build stages using editable standard tasks; run two stages in parallel with a third waiting for both; insert a sequential task; complete an approval as either founder; inspect and replace a supervisor across selected projects; receive the replacement's personal digest; refresh/reopen and verify the saved state and access. Also repeat onboarding with members present at group creation, and exercise bare and populated Telegram commands.
