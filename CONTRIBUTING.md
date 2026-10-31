# Contributing

## Choose the application first

Bot behavior belongs in `src/bot/`, workflow rules in `src/workflow/`, and external
service calls in `src/integrations/`. The Google Sheets adapter owns its API calls.
The local workspace and production web app have separate data stores and login
models; make the change in the application that actually owns the behavior.

The production web app has a separate Git history. Inspect and commit changes
inside that repository separately. Do not accidentally add it as an embedded Git
repository to the parent repository.

## Keep changes easy to review

- Keep related UI, helpers, and tests together under their feature.
- Keep shared UI primitives in `components/ui/` and generic browser helpers in `lib/`.
- Keep startup and dependency wiring in entry/application modules. Importing a
  handler must not start polling, open a server, or initialize production data.
- Give a module one clear responsibility. Extract code when it has a distinct
  job or repeated use; avoid forwarding wrappers and speculative abstractions.
- Preserve authorization, validation, audit records, retry behavior, and
  idempotency when moving code. An idempotent operation can safely be repeated.
- Keep tests beside the code. Test meaningful behavior, especially access control,
  scheduling, durable writes, and delivery failures.
- Update the architecture or setup guide when data ownership, environment,
  process entry points, or deployment requirements change.

## Before handing over a change

```sh
npm ci
npm --prefix frontend ci
npm run verify
npm run format:check
```

Run `npm run verify` and `npm run format:check` inside the production web repository
when changing that application. `npm run verify:all` from the parent runs both
applications' functional checks when the nested checkout is present.

Use the pinned Prettier version through `npm run format`. Do not hand-edit built
bundles, lockfiles, or generated workflow data. Regenerate them through their
own build/import commands when the source changes.

CI runs the same formatting, syntax, test, and build checks. Local tests may need
permission to bind loopback HTTP ports in a restricted development environment.

## Data and deployments

Never commit `.env`, runtime databases, or real client uploads. Use test fixtures
and the temporary workspace demo for verification. Keep one bot polling worker.
Do not start the bot with production tokens as a smoke test. Keep database
changes separate from source moves and test migrations against a backup.
