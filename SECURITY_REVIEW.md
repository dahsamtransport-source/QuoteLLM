# API boundary follow-up — 2026-10-08

This branch builds on the dependency/CI draft in PR #1. It adds bounded streamed
request reads (including missing or forged Content-Length), a five-second body
deadline, explicit conversation roles/slot shape validation, model-response shape
checks, upload type/size limits, provider timeouts and generic provider errors.
MCP batches are bounded and malformed requests no longer crash the handler.
Sensitive chat/OCR/audio/MCP responses use no-store. Vercel installs from the lockfile.

Validation: nine offline API tests, API and frontend TypeScript checks, and the
frontend production build passed. API tests mock upstream services and do not
spend provider credits. Run `node --test tests/api.test.mjs` after `npm ci --prefix web`.
Run `node web/node_modules/typescript/bin/tsc -p tsconfig.api.json` for API typing.
CI runs these checks; prior builds checked only frontend and stdio MCP source.

## Remaining release gates

- Paid chat/OCR/STT/TTS routes are still public. Per-request bounds are not caller
  authentication, distributed throttling, bot protection or a provider spending
  ceiling. Configure an authenticated gateway or an appropriate public-user
  admission service with durable shared quotas before public production use.
  CORS does not provide this protection. No client-side API secret was added.
- npm reports seven frontend build-chain advisories (five high, two moderate).
  They remain in the inherited Tailwind 3 toolchain; this patch does not claim
  a clean dependency audit or force an untested major framework migration.
- Pricing/reimbursement constants and the assistant's insurance/privacy claims
  lack a verified authoritative source. They must not be treated as approved
  contractual quotes or proof of privacy compliance.
- No live model, speech provider, deployed Vercel configuration, or real customer
  document was used to validate this patch. Full stdio MCP protocol compatibility
  and every frontend flow were not retested in this follow-up.
