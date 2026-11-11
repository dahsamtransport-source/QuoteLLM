---
name: pharma-repository-audit
description: Audit repository completeness using code evidence, never inferred feature status.
---

# Repository audit

1. Read AGENTS.md, README, project scripts, instructions and deployment configuration before assessment.
2. Map entry points, API boundaries, auth, migrations, CI, tests, mobile build and runtime dependencies.
3. Search TODO, FIXME, HACK, STUB and PLACEHOLDER; follow actual call paths.
4. Classify implemented, partial, stub, not evidenced, or blocked, citing paths and functions.
5. Separate code inspection from executed tests and production verification.
6. Deliver prioritized finding, evidence, severity, test, owner and residual risk.

Read-only by default. Never change secrets, deployments, branches or live data during an audit.
