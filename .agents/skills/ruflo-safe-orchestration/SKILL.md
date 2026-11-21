---
name: ruflo-safe-orchestration
description: Read-first scoped Ruflo multi-agent review for QuoteLLM insurance/quotation application; no automatic privileged execution.
allowed-tools: Read Glob Grep
---
# Ruflo safe project orchestration

Project: QuoteLLM insurance/quotation application

Pinned source registry: https://github.com/muslly-pharmcy/everything-claude-code/tree/feat/ruflo-complete-skills-library-20261121/vendor/ruflo
Upstream Ruflo revision: `87f612cef121b50c2e31e2d3f88e46d88963a377`.

1. Read project README, AGENTS.md if present, and existing skills first.
2. Scope research → architecture → implementation in an isolated worktree → testing → security review. Use only needed, reviewed Ruflo skills; do not spawn 60 agents automatically.
3. Prefer security-scan, test-gaps, git-workflow, harness-mcp-scan, and pii-detect as candidates after reading source and verifying compatibility.
4. Keep customer/insurance documents, attachments, keys and financial records private. No tool may send client data to external LLM/MCP services without explicit scope and appropriate protection.
5. Never auto-install @latest packages or external scripts, run fix-mode tooling, modify production data/deployments, share secrets or PII, or grant broad agent permissions without review.
6. Keep outcomes truthful: indexed is not installed, installed is not runtime verified, and a proposed PR is not a production release. Include tests and rollback notes before merging.
