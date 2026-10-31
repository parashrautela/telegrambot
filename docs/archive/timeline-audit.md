> Historical record. Use the current application README and architecture guide for setup and ownership.

# Timeline audit: what works, what's broken, what will break, and why

Date: 15 October 2026
Scope: every place a schedule is computed or shown. This audit is read-only; no code was changed.
Method:
- Four parallel audits (scheduling engine, local workspace timeline, deployed web timeline, design review).
- Probe scripts were run against the real code.
- The main claims were spot-checked by hand.
- The local demo was viewed at desktop and phone width.

Existing tests pass: `check-workflow-engine` passes, `test:workspace` passes 17/17, and the production-web timeline/graph tests pass 26/26. The failures below come from cases those tests don't cover.

---

## 0. The one-line verdict

**There is no single timeline. There are four, they disagree with each other, and in production none of them can show a founder a real, up-to-date schedule.** The residential template has no durations, delays don't flow through, and the deployed app opens on a template preview instead of the project.

---

## 1. What "the timeline" is today

| # | Where | Data store | How dates are made | End-date convention | Editable | Used by |
|---|---|---|---|---|---|---|
| A | Bot engine, `src/workflow/engine.js` | Google Sheets | Dependency graph (FS/SS), delay forecasts | Inclusive | Through Telegram `/delay` | Only `RESIDENTIAL-INTERIOR-V1` |
| A′ | Legacy loop, `src/projects/service.js:92-111` | Google Sheets | One after another, ignores dependencies | Inclusive | `/delay` changes status only | HOUSE, RESTORATION, PAINTING, INTERIOR (4 of 5 plans) |
| B | Local workspace, `frontend/src/features/workspace/Timeline.tsx` | SQLite | Typed by hand or dragged, 30-minute snap | Exclusive datetime | Yes, by drag or dialog | Not deployed |
| C | Deployed web, "Project tasks" mode, `work/production-web/frontend/src/features/timeline/lib/timeline.js` | Postgres, synced from the bot | Reads Current, then deadline, then Planned. Ignores Forecast | Inclusive, plus 1 day | No | Production |
| D | Deployed web, "Sheet plan" mode (the default), `sheetPlan.js` | JSON snapshot of an XLSX file, baked into the build | Chained one after another, ignores dependencies and work order | Exclusive, minus 1 day | No | Production, as the default tab |

Field names differ in each one: `scheduledStart`, `PlannedStart`, `sourceCurrentStart`, `deadline`. No code is shared between them.

---

## 2. What's working (keep this)

**Engine (A)**
- FS/SS scheduling is correct.
- At a join, the latest predecessor wins, and slack is respected.
- Cycles, self-loops and missing steps are rejected.
- Dates are UTC-only, with no DST drift.
- Unknown durations stay unknown instead of becoming 0.
- A delay keeps the Planned and Current dates and leaves independent work alone.
- The completion gate blocks on unfinished predecessors.

**Local workspace (B)**
- Schedules save and are validated on the server.
- Permissions are founder-or-owner, enforced on both client and server.
- Order stays stable.
- A failed save puts the bar back.
- The 8-second polling doesn't move a bar while you drag it.
- There's a date dialog as an alternative to dragging.

**Deployed web (C/D)**
- Day-only UTC maths, with impossible dates rejected.
- Week, Fortnight, Month and Entire-plan zoom.
- The owner and status show on each bar.
- Search auto-expands stages.
- The stage details sheet works.
- Missing durations are shown honestly ("Missing in source sheet").

**Design patterns worth keeping**
- Sticky label column and date header.
- Grouping by stage with a summary bar.
- A "Show" jump for items outside the visible window.
- A date dialog as the accessible alternative.

---

## 3. Broken now

### P0: blocks the product goal or silently corrupts data

| # | Problem | Where | Proof |
|---|---|---|---|
| 1 | **Residential projects can't be scheduled at all.** Every duration is blank, and nothing exists to fill them in. | `src/workflow/residential-interior.js:14` | 0 of 42 tasks get dates. Planned finish shows "Unconfirmed". |
| 2 | **Delays never re-forecast for 4 of 5 plans.** The engine only runs when `TemplateVersion` is set; legacy plans get a status change only. | `src/index.js:943-947` | The founder approves +5 days and no date moves. |
| 3 | **One approved delay turns that task into a wall.** `'Delayed — Approved'` counts as "started", so later upstream delays don't pass through it. | `src/workflow/engine.js:8` | Chain A→B→C. Approve B+2, then A+5. B now starts before A ends, and C doesn't move. |
| 4 | **An upstream delay wipes out an earlier downstream delay.** Delays are stored only as changed dates, not as constraints, so recomputing forgets them. | `workflow-engine.js:275-278` | B+10, then A+1: B snaps back 9 days. |
| 5 | **Sheets writes go to the wrong row when there's a blank row.** Blank rows are removed before row numbers are assigned. | `src/storage/sheets.js:116-117` | One stray empty row in Tasks makes every later update land one row off. |
| 6 | **The deployed timeline opens on a template, not the project.** The default `mode='sheet'` shows "INTERIOR 1" dated from the start date. Every item reads "Plan item" with 0% progress. | `ProjectTimelineWorkspace.jsx:13` | Linking to real tasks needs an exact stage and title match. The bot's stage/task naming is inverted compared with the sheet, so **0 of 42** tasks link. A project three weeks late looks on plan. |
| 7 | **Neither UI shows what's late.** No bar compares its end with today. Overdue items look the same as future ones. | `workspace-timeline.tsx:94`; `ProjectTimeline.jsx` | A founder cannot answer "what's late?" from any timeline. |

### P1: wrong output under normal use

**Engine (A)**
- **Delaying a task that hasn't started stretches it instead of shifting it.** A 3-day task becomes 5 days, and its SS successors don't move (`sheets.js:308` + `workflow-engine.js:210`).
- **Actual dates are never recorded.** Finishing early or late never moves successors, and nothing ever sets `'In Progress'` (`workflow-engine.js:145`, `index.js:440`).
- **Recompute order follows sheet row order, not dependency order.** Sorting the sheet produces broken FS chains (`workflow-engine.js:225-238`).
- **Unknown edge types are silently accepted.**
  - `FF` and `SS+2` are treated as FS.
  - Lowercase `ss` skips the completion gate entirely (`workflow-engine.js:22-25, 91, 182`).
- **Duplicate sequence numbers produce duplicate TaskIDs.** The delay write-back then lands on the wrong task (`workflow-engine.js:77,121`).
- **A partly dated plan still publishes a project finish date** to `Projects.TargetEndDate` (`workflow-engine.js:114`).
- **`/tasks` and `TargetEndDate` never show the forecast.** Users always see the original baseline (`index.js:499`).
- **`/tradeorder confirm` recomputes from scratch** and loses earlier delays on 18 tasks (`index.js:676-716`).
- **`/delay` on a Completed task un-completes it** and blocks every successor (`index.js:520-528`).
- **Switching plans archives the old tasks before checking the new graph.** One error leaves the project with 0 tasks (`project-service.js:69-82`).
- **Sheets dates in a non-ISO format crash the delay engine.** Start-date parsing turns "tomorrow" into 1 Jan and reads "5/1" in US order (`sheets.js:113`, `index.js:154`).

**Local workspace (B)**
- **Dragging a bar out of the 7-day window leaves an unsaved "ghost" schedule.** Simply hovering afterwards keeps moving it (`workspace-timeline.tsx:93-94`).
- **Lost updates.** There's no version check, so the founder's and the owner's edits silently overwrite each other (`workspace-store.js:346-371`).
- **Activation throws away the template's durations and dependencies.** All 42 tasks start unscheduled and have to be placed by hand (`workspace-store.js:203-205`).
- **The audit log says only "Task updated: Open"**, with no before/after dates. The owner isn't notified when the founder moves their work (`workspace-store.js:369-370`).
- **On a phone, bars block scrolling, and a 5px finger slip saves a reschedule** (`workspace-design.css:119`).
- **The 7-day window is the maximum.** A 6-month build means about 26 clicks of "Next week".
- **New schedules default to 2 hours** (09:00–11:00), which draws as a 6px sliver you can't grab (`workspace-timeline.tsx:43-45`).

**Deployed web (C/D)**
- **Every pilot-workflow project is off by one day.** `pilot.js:190-191` stores `deadline` as an exclusive end, and `timeline.js:15` adds another day. Each stage overlaps the next by a day, and the Overview "Target" disagrees with the timeline.
- **Telegram delays never reach the web timeline.** The bot writes `Forecast*`, and `timelineItems` never reads it (`timeline.js:11-12`).
- **Web deadline edits fight the bot's dates.**
  - `CurrentEnd` wins over `deadline`.
  - The bot's sync handler writes the deadline into **both** PlannedEnd and CurrentEnd, which destroys the baseline.
  - Moving the deadline before the start date silently turns the task "unscheduled".
- **Sync marks tasks Synced before hydrating them**, so a stale snapshot can silently undo a web edit (`task-sync.js:46-49` vs `:90`).
- **Cross-repo break.** The deployed web calls `/api/integrations/web/tasks/sync` and `/projects/start`. These exist only on the bot's `origin/main` (commit 855097b), not on this branch (`codex/telegram-decision-inbox`). **Deploying the bot from this branch would make every sync fail.**

**Design (both)**
- **Blocked or waiting-on-founder work isn't visible on the grid.**
  - It shows only as a low-contrast dot or a 9–10px word.
  - Status relies on colour alone, which fails WCAG non-text contrast.
- **No line marks today.** The today header tint has a 1.11:1 contrast ratio.
- **Unscheduled work is scattered as chips inside collapsed stages.** It should be its own section with a reason.
- **The local workspace lands on Timeline every time.** The plan says land on "Now"; the timeline is secondary.
- **The deployed web opens on the earliest date, not today.** A project in month 3 opens in month 1.

### P2: polish, but real
- Hours-view labels are misplaced: "06:00" sits at 08:00. The whole Hours mode doesn't fit construction work.
- Snapping applies to the size of the move, not the clock, so 09:17 stays 09:17.
- The local timeline uses the browser's timezone instead of the project timezone.
- Resolved and completed tasks can still be rescheduled.
- The deployed timeline shows "Duration needed" on items that do have a duration (the real issue is a missing predecessor). One null in the main lane leaves 10 of 12 items unscheduled.
- Items with the same work order are scheduled one after another instead of in parallel.
- The graph's cycle warning names tasks that aren't in the cycle.
- There is no React error boundary. An invalid `startDate` or a bad re-import blanks the whole app.
- Terminology differs between the two UIs: Resolved vs Completed, "to plan" vs "without dates", Days/Hours vs Week/Month.
- The heading is a tagline ("Make room for good work.") where a status line should be.
- Stage colours repeat after five stages.

---

## 4. Will break (as soon as real usage grows)

- **Two or three sources of truth drift apart.** Sheets (bot), SQLite (local web) and Postgres (deployed web) each keep their own task dates for the same project. The master plan §8.2 forbids this.
- **Sheets quota and partial writes.** One delay on residential step 5 rewrites about 42 rows, one API call per row. A failure midway leaves a half-propagated schedule with no retry.
- **Concurrent edits.** Writes go by row position with no lock or version. A manual sort or insert in the sheet, a second bot process, or the web bridge will corrupt rows.
- **Scale in the UI.**
  - At 150 tasks the grid is about 10,500px tall, with roughly 8 rows visible.
  - "Entire plan" squeezes to 8px per day.
  - The 8-second full-snapshot polling grows with every project.
  - There's no virtualization.
- **Parallel trades.** With one row per task and no lanes per person or trade, nobody can see that a carpenter is double-booked.
- **No dependencies in the web models.** Once dependencies exist, dragging will happily put a successor before its predecessor.
- **Manual pipelines.**
  - The deployed `app.js` is a hand-committed build with no check that it matches the sources.
  - The sheet plan is a hand-run XLSX-to-JSON snapshot.
  - Local `main` is behind `origin/main`.
- **No timeline tests.** There are no frontend tests at all locally, and nothing tests the schedule PATCH route or the drag maths.

---

## 5. Why it's there: six root causes

1. **Nobody owns the schedule.** Each surface invented its own date model: field names, inclusive vs exclusive ends, datetime vs date. There is no shared contract, so every port reintroduces off-by-one and drift bugs. → §1 table, pilot off-by-one, the forecast being ignored, two or three sources of truth.
2. **A delay is a one-off edit to dates, not a stored fact.** No Delay or constraint record and no actual dates exist, so "started" is guessed from the status text. Recomputes forget earlier delays, and statuses double as scheduling flags. → P0 3 and 4, the stretch-vs-shift bug, `/tradeorder` erasure.
3. **Templates don't carry real schedule inputs.**
   - Residential durations were left unconfirmed on purpose, with no tool to confirm them later.
   - The local workspace drops durations and dependencies when a project is activated.
   - The deployed web uses a separate XLSX copy.

   → P0 1, and every task starting unscheduled.
4. **The timeline was designed as a calendar for placing blocks, not as a status tool.** It answers "where does this block go?", not "what's wrong?". → no overdue or blocked states, the tagline header, the 7-day and hourly model, landing on the timeline.
5. **Google Sheets is used as a database, keyed by row position, with formatted reads.** → wrong-row writes, crashes on date formats, quota and concurrency risk.
6. **Two codebases move separately with hand-run pipelines.** → branch divergence, bundle drift, a stale sheet snapshot, different terminology.

---

## 6. Product decisions needed before any code

1. **Who owns the schedule?**
   - Recommendation: one schedule service (the engine's graph model) is the only writer.
   - Telegram and the web become input sources.
   - Sheets becomes an export or audit view, not the database the timeline reads.
2. **Which UI is the base?**
   - Recommendation: the deployed `ProjectTimeline` in project-tasks mode. It's read-only, day-based and has zoom.
   - Keep the local dialog and its permission gate.
   - Drop Hours mode.
   - Leave dragging out until dependency-aware preview exists.
3. **Date contract.**
   - Store calendar dates only, with an exclusive end internally and an inclusive end for display, in the project timezone (Asia/Kolkata).
   - Keep separate Baseline, Forecast and Actual dates.
4. **Durations for the residential template.** The founders have to supply them. Without them, nothing can be scheduled.
5. **What the timeline must answer in 10 seconds.**
   - Late, blocked, waiting on you, and what moves if X slips.
   - That sets the header and the bar states.
   - The default window runs from 2 weeks back to 4 weeks ahead, with a line marking today.

## 7. Low-risk fixes that don't depend on those decisions

| Fix | File | Size |
|---|---|---|
| Assign `rowNumber` before removing blank rows | `src/storage/sheets.js:116` | 1 line |
| Make "Project tasks" the default timeline mode | `ProjectTimelineWorkspace.jsx:13` | 1 line |
| Fix the pilot exclusive-deadline off-by-one | `backend/tasks/pilot.js:190-191` | small |
| Read `sourceForecast*` before Current in `timelineItems` | `lib/timeline.js:11-12` | small |
| Remove `'Delayed — Approved'`/`'Delay Requested'` from `STARTED_STATUSES` (stopgap until actual dates exist) | `src/workflow/engine.js:8` | 1 line + tests |
| Block `/delay` on Completed tasks | `src/index.js:520` | small |
| Fix the ghost-drag bug (keys, plus `lostpointercapture`) | `workspace-timeline.tsx:93-94` | small |
| Reject unknown edge types | `workflow-engine.js:22-25` | small |
