# Founder workspace implementation — 11 October 2026

The local workspace now has a redesigned founder home, project Now/Plan/History views, contextual task panels, and a single founder intervention badge. The former permanent three-column chat/notification layout is removed.

## Implemented

- Persisted intervention queue with separate read and handled state, Gosik/Nishank ownership buttons, and version conflicts.
- Backtrack with linked instructions, recent internal/external conversation and confirmed Telegram replies, references, and paginated recorded task events.
- Staff roles including Site supervisor, project memberships, assignment, required-input verification, and protected task actions.
- Reference links with founder approval and retained superseded references.
- Completion evidence links and linked Telegram photos, founder-only approval, correction feedback, and resubmission history.
- Canonical local task dates/dependencies, calendar-day forecasting, baseline/actual preservation, automatic delay cascades, and an optional draggable 28-day plan with date-edit alternatives.
- Ordinary approved external-trade question capture in the existing bot worker; uniquely assigned external workers can be linked to work automatically. Ambiguous items remain unlinked.
- Authenticated bounded Telegram attachment proxy when the workspace service has its group bot token.
- Persisted outgoing reply intents, confirmed/failed/uncertain delivery state, failed retry, founder reconciliation, and queued-job recovery. The isolated preview has no bot token and sends no external messages.
- Recent project event catch-up with a per-tab checkpoint and preserved unsent drafts during refresh.
- Responsive desktop/mobile layout, focus-managed native dialogs, and keyboard alternatives.

## Verification

- `npm run frontend:build`: passes.
- `npm run test:workspace`: 28 tests pass.
- `npm run test:requests`: 8 tests pass.
- `npm run check`: passes, including the existing 42-task residential workflow check.
- New operational modules pass Node syntax checks; `git diff --check` passes.
- Browser checks in the isolated demo verified desktop/mobile home, intervention ownership, Backtrack context, and review rejection with persisted correction feedback.

## Production boundaries and remaining master-plan work

This implementation targets the `/api/workspace` service in this checkout. The separate web repository documented in the prior pilot handoff has not been modified or verified as deployed.

Local workspace tasks and existing bot/Sheets schedules remain separate. No production data migration, task-ownership cutover, deployment, or live Telegram messaging was performed. Existing work and files were preserved.

Still required before the complete master plan is production-ready:

- Verify the selected production repository/environment and migrate operational ownership using stable legacy mappings.
- Add durable Telegram update ingestion/checkpoint recovery before processing (current capture retries begin after the request is saved).
- Archive media into durable object storage. Current references and Telegram proxying do not provide immutable file snapshots or media archival.
- Formalize role-specific input/release policies, resource version families, approved contractor release, and optional client approval gates for each project type.
- Add working calendars/holidays, milestones, full schedule-impact preview, wider timeline navigation, and started-work/resource conflict review.
- Add server-backed session catch-up checkpoints, recorded commitments, participant deactivation, and robust history backfill.
- Add AI routing, evidence-grounded summaries/drafts, and automatic public status policy after canonical progress is reliable. Current catch-up and routing are deterministic; no new AI automation is presented as working.
- Complete live media/delivery, restore, two-founder production sessions, and one-project pilot acceptance.

## Local preview

Run `npm run frontend:build`, then `npm run workspace:demo`. It creates a disposable SQLite workspace, prints temporary founder/designer/supervisor credentials, and serves the result at `http://127.0.0.1:3002`.

For the persistent local service use `npm run workspace` with the existing founder/environment setup. `GROUP_BOT_TOKEN` is used only on the server for authenticated media and explicitly queued replies. No credentials belong in the frontend.
