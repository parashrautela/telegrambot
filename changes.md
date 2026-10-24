# Changes

## 22 October 2026 — Bot client review fixes

Implemented the non-Google-sign-in client-review backlog. See [implementation and validation](docs/client-review-implementation-2026-10-22.md) for scope, tests, release order and limitations.

- Telegram discovery recovery, multiple project roles/clients and task eligibility.
- Daily work queues, employee workload filters, supervisor transfer and private morning digest connection/scheduling.
- Spaces, editable standard tasks, sequential placement, branching stage links and reusable plan templates.
- Navigation, validation and concise message/summary cleanup.
- Validation: 84 web tests, 75 bot tests, production web build and bot syntax checks pass.
- Release pending: Railway has paused deploys during an upstream outage. No new production release.


## 2026-10-24 — task shares and meeting notifications

Added authenticated task-notice transport for the web communication/meeting release. It verifies active project recipients, sends safe text mentions and optional image/PDF uploads as multipart documents, uses bounded requests and reports partial failure without claiming delivery. Private Start registration now supports project participants for meeting notifications; digest staff behavior remains. 77 bot tests pass, including safe mentions, multipart files, departed recipients and partial failure. Production publication pending; release this bot before the companion web app. No real messages were sent during validation.

Published review: https://github.com/parashrautela/telegrambot/pull/18 (3f8c226). Companion web: https://github.com/parashrautela/workflow-managment-/pull/31. Both remain drafts; production is unchanged.
