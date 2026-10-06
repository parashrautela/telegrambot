# Linked six-step stages

Each configured stage runs site details, drawing, internal approval, client approval,
execution and final check in that order. Each step has an explicitly selected active
Telegram member and confirmed duration. Independent stages run in parallel; a stage
with dependencies waits for the final checks of those stages.

The bot is the state authority. Web actions resolve the actor from the authenticated
session; arbitrary actor IDs and direct status edits cannot complete linked steps.
Drawing completion requires a task-linked upload for the current revision. Both
approvals must refer to that revision before execution. Requesting changes reopens
the drawing and invalidates the downstream approvals. Holds pause dependent forecasts;
resume recalculates forecast dates while retaining planned dates.

Replies to the assigned task message, including album follow-ups, are saved against
that task. Uploading does not complete work. The next Telegram handoff tags the
assignee and includes predecessor context and drawing references.

## Start and release

Deploy this bot version before the paired web version. New Sheet columns are appended;
existing columns retain their order. Start linked stages on a freshly onboarded project.
An existing active plan is refused rather than overwritten. No migration of Ravi home 2
or other existing projects is included.

The sheet provided by the user is the planning reference. Missing durations, the
internal approver and working-day policy require explicit configuration in the web UI.
Google Drive archival uses the existing archive worker; a queued file is not proof
of successful Drive storage. Live Drive upload and retrieval still need verification.

## Recovery limits

Handoffs are claimed before sending. Interrupted or uncertain sends remain Sending
or Unknown and are not automatically replayed, to avoid duplicate group messages.
An assignee who leaves the group blocks the step as Needs assignment. This version
shows these states but does not include self-service reassignment or reconciliation.
Project locks assume a single bot process; do not scale to multiple writers without
a shared transactional lock.

## Validation

Workflow tests cover six-step ordering, authorization, approval gates, rejection and
revision invalidation, parallel/dependent stages, working days, holds and forecasts.
Service tests cover retry-safe creation, preserving existing work, handoff message
mapping, uncertain sends, task replies/albums and required drawing uploads.
A local web-plus-bot bridge pilot used only fictional members and mocked Telegram
transport; no live project tasks or messages were changed.
