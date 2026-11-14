import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(fileURLToPath(new URL('../web/src/hooks/useConversation.ts', import.meta.url)), 'utf8');
const upload = source.slice(source.indexOf('const handleDocUpload ='), source.indexOf('const handleDocEnterManually ='));

test('unprocessed insurance cards never produce a fabricated insurer or regime', () => {
  assert.ok(upload.includes('const handleDocUpload ='), 'upload handler not found');
  assert.doesNotMatch(upload, /current_insurer:\s*['"]MGEN['"]/);
  assert.doesNotMatch(upload, /regime:\s*['"]general['"]/);
});

test('upload flow explicitly discloses that no OCR analysis took place', () => {
  assert.match(upload, /document non analysé|document n.a pas été analysé|document n'est pas analysé/i);
  assert.doesNotMatch(upload, /J'ai bien analysé ton document/);
});
