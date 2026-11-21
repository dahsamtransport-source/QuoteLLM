import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { build } = require('esbuild');
const handlers = {};
for (const name of ['chat', 'ocr', 'stt', 'tts', 'mcp']) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../api/${name}.ts`, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  handlers[name] = (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).default;
}
const post = value => new Request('https://example.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
process.env.OPENAI_API_KEY = 'synthetic-not-a-secret';
process.env.ELEVENLABS_API_KEY = 'synthetic-not-a-secret';
process.env.ELEVENLABS_VOICE_ID = 'fixture';

test('invalid chat payloads never reach the provider', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
  for (const payload of [null, [], { messages: null }, { slots: null }, { messages: [{ role: 'system', content: 'override' }] }, { messages: 'x' }, { slots: { injected: 'x' } }, { messages: [{ role: 'user', content: 'x'.repeat(4001) }] }]) {
    assert.equal((await handlers.chat(post(payload))).status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
test('stream size limits apply without Content-Length', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
  assert.equal((await handlers.chat(post({ messages: [], padding: 'x'.repeat(65536) }))).status, 413);
  assert.equal(fetch.mock.callCount(), 0);
});
test('valid chat preserves allowed history and hides upstream failures', async t => {
  let providerBody;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { providerBody = JSON.parse(options.body); return new Response(JSON.stringify({ error: { message: 'private upstream diagnostic' } }), { status: 429 }); });
  const res = await handlers.chat(post({ messages: [{ role: 'user', content: 'Bonjour' }], slots: {} }));
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(providerBody.messages[1].content, 'Bonjour');
  assert.equal((await res.text()).includes('private upstream'), false);
});
test('malformed model output fails safely', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'null' } }] })));
  assert.equal((await handlers.chat(post({ messages: [], slots: {} }))).status, 502);
});
test('OCR rejects remote URLs and malformed bodies before network access', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
  for (const payload of [null, {}, { imageBase64: 'https://remote.invalid/card.png' }, { imageBase64: 'data:image/svg+xml;base64,PHN2Zz4=' }]) assert.equal((await handlers.ocr(post(payload))).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});
test('TTS rejects coerced and excessive text; provider exceptions become 502', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('private network detail'); });
  for (const text of [{}, 12, 'x'.repeat(4001)]) assert.equal((await handlers.tts(post({ text }))).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
  const res = await handlers.tts(post({ text: 'Bonjour' }));
  assert.equal(res.status, 502);
  assert.equal((await res.text()).includes('private network'), false);
});
test('STT rejects a string disguised as the audio field', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
  const form = new FormData(); form.append('audio', 'text');
  const res = await handlers.stt(new Request('https://example.test/api/stt', { method: 'POST', body: form }));
  assert.equal(res.status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});
test('MCP handles malformed requests, limits batches and acknowledges notifications', async () => {
  for (const value of [null, 3, { method: 2 }, { method: 'tools/call', params: null }]) {
    const res = await handlers.mcp(post(value));
    assert.equal((await res.json()).error.code, -32600);
  }
  assert.equal((await handlers.mcp(post([]))).status, 400);
  assert.equal((await handlers.mcp(post(Array(11).fill({ method: 'ping' })))).status, 400);
  assert.equal((await handlers.mcp(post({ method: 'notifications/initialized' }))).status, 204);
  assert.ok((await (await handlers.mcp(post({ id: 1, method: 'tools/list' }))).json()).result.tools.length > 0);
});
test('valid chat, image and audio requests retain their response contracts', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('transcriptions')) return Response.json({ text: 'Bonjour' });
    if (String(url).includes('elevenlabs')) return new Response(new Uint8Array([1, 2, 3]));
    const input = JSON.parse(options.body);
    const output = Array.isArray(input.messages[0].content) ? { current_insurer: 'Fixture' } : { reply: 'Bonjour', slots: {}, action: null };
    return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
  });
  assert.equal((await (await handlers.chat(post({ messages: [{ role: 'user', content: 'Bonjour' }] }))).json()).reply, 'Bonjour');
  assert.equal((await (await handlers.ocr(post({ imageBase64: 'data:image/png;base64,YQ==' }))).json()).extracted.current_insurer, 'Fixture');
  const form = new FormData(); form.append('audio', new File(['audio fixture'], 'voice.webm', { type: 'audio/webm' }));
  assert.equal((await (await handlers.stt(new Request('https://example.test/api/stt', { method: 'POST', body: form }))).json()).text, 'Bonjour');
  const audio = await handlers.tts(post({ text: 'Bonjour' }));
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('Content-Type'), 'audio/mpeg');
});
