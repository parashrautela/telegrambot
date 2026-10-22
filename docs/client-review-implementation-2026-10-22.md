# Client review implementation — 22 October 2026

Google sign-in is excluded by the user's instruction. All other scoped deliverables have source implementations; deployment and live acceptance are separate.

| Priority | Deliverables implemented |
|---|---|
| P0 | Verified Telegram member recovery and honest roster guidance; multiple roles/clients; shared-role/founder task eligibility and duplicate approval protection; accidental standalone creation/navigation cleanup |
| P1 | Actions needed and employee workload views; selected-project supervisor replacement; personal morning digests; project spaces; editable branching stage connections; sequential task forms |
| P2 | Editable six-task defaults and Skip; reusable workspace plan templates; Assignee wording/project roles; direct stage collapse; concise work summaries and welcomes; retained empty-command validation |
| Excluded | Google sign-in and admission workflow |

## Validation

- 84 web backend/frontend logic tests and 75 bot tests pass.
- Production Vite build passes. Bot entry points pass syntax checks. Both diffs pass whitespace checks.
- HTTP tests cover atomic template batches, parallel stages/two predecessors, spaces, stale guards, restart persistence, multiple-client intake and departure revocation.
- Browser acceptance on disposable local data covered task opening and prerequisite completion guard; editable standard rows with Skip/rooms; stage creation; connection preview/save; supervisor preview/apply and replacement workload; digest schedule save.
- Telegram sends are mocked in tests. Real desktop/mobile command interaction, a newly created group and the first real private digest require acceptance after deployment.

## Release

Railway's production service currently reports: **Limited Access — Deploys have been paused due to an upstream issue.** No new production release has been deployed.

Deploy bot first, then web. The web requires the new bridge routes. Bot startup appends `ClientTelegramIDs` after existing Projects columns; legacy primary-client and role fields remain readable. Existing environment settings are reused; do not copy local bot tokens into production.

## Operating decisions

- Any active Client can fulfil role-based client work unless a named assignee is selected. Shared roles use a common eligible queue unless a named assignee is selected.
- Replacement transfers outstanding supervisor tasks and future supervisor routing on selected projects, retaining other roles and completed history.
- Digests default to 09:00 Asia/Kolkata, daily. Each recipient must press Start using their own account. Empty and future-only work is skipped. Uncertain delivery is retained as Unknown and never automatically resent.
- Telegram cannot enumerate all unknown existing members. A missing silent person must send `/join` or be recovered by verified numeric ID.
- Reusable templates keep stage links, roles, durations and applicable destination spaces; named people are selected for the destination project.
- Legacy unlinked-project API remains compatible; accidental creation buttons are removed from normal navigation.
