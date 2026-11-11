---
name: pharma-release-gate
description: Gate releases on measured builds, tests, security and rollback readiness.
---

# Release gate

- Read AGENTS.md, branch/remote, dependency lockfiles and deployment target; keep credentials secret.
- Run lint, typecheck, unit/integration tests, production build and browser/device smoke tests where available.
- Verify migrations/RLS, tenant isolation, accounting/stock invariants, offline recovery, secret scanning and rollback.
- Label each gate PASS (executed), FAIL, BLOCKED or NOT RUN; attach commands and log links.
- Do not imply production readiness from a static review, or deploy/merge/post/alter live data without scoped authorization.
