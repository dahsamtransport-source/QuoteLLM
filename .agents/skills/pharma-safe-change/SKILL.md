---
name: pharma-safe-change
description: Make minimal, reviewable code changes with rollback and regression coverage.
---

# Safe change

- Verify repository, branch, git status, scope and existing AGENTS.md instructions first.
- Prefer a separate branch, minimal patch, and focused tests over broad rewrites.
- Preserve published Lovable history and generated resources. Honor existing ownership boundaries.
- Never weaken RLS, disable tests, mask failures or invent test results.
- Record exact changed files, tests, observed results, unresolved risks and rollback.
- Do not execute destructive SQL, production posting, deployments or merges without scoped approval.
- Never print credentials; keep project boundaries isolated.
