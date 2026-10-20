# Network Monitor Copilot Instructions

## Project context
- Monorepo with two main apps: backend (Node.js + TypeScript + Prisma) and UI (React + Vite + TypeScript).
- Runtime stack in Docker Compose: api, poller, syslog-collector, trap-collector, postgres, redis, ui.
- Prefer minimal, targeted changes over broad refactors.

## Working style
- For non-trivial work, define scope first, then implement in small verifiable steps.
- Keep each change focused and easy to review.
- Do not mix formatting-only edits with behavior changes.
- Preserve existing conventions in neighboring files.

## Release and memory discipline
- After each meaningful code change, update `CHANGELOG.md` with a clear summary.
- After committing, create an annotated SemVer tag for rollback:
  - `./deploy/version-tag.sh vX.Y.Z "<short description>"`
  - Add `--push` when the tag should be published.
- Keep fast context docs up to date so future sessions do not need full rediscovery:
  - Update `docs/PROJECT-MEMORY.md` for feature/module/entrypoint changes.
  - If architecture changes, also update `ARCHITECTURE.md`.

## Safety boundaries
- Always ask before destructive schema or data operations.
- Always ask before introducing new external dependencies.
- Never remove failing tests just to get green CI.
- Never commit secrets or credentials.

## Backend conventions
- Use Zod for request validation where route input is involved.
- Keep API route behavior explicit and backward-compatible unless change is requested.
- For bug fixes, add a guard test first when feasible.
- If changing Prisma models/migrations, explain impact and rollout notes.

## UI conventions
- Keep UI behavior consistent with existing component patterns and service adapters.
- Ensure responsive behavior and avoid layout regressions.
- Keep API calls in service layer, not scattered across components.

## Verification checklist per change
- Backend touched:
  - Run: npm run build (in backend)
- UI touched:
  - Run: npm run lint and npm run build (in UI)
- If Docker/runtime behavior is affected:
  - Rebuild stack: docker compose up -d --build
- Summarize what was verified and what was not run.

## Useful commands
- Backend dev: npm run dev:api, npm run dev:poller
- Backend build: npm run build
- UI dev: npm run dev
- UI check: npm run lint
- UI build: npm run build
- Full stack rebuild: docker compose up -d --build
