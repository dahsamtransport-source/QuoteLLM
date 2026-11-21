import { boundedJson, InputError, inputResponse } from '../lib/api-input.js';
export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors });
  }

  const elKey   = (globalThis as any).process?.env?.ELEVENLABS_API_KEY
    ?? (globalThis as any).ELEVENLABS_API_KEY;
  const elVoice = (globalThis as any).process?.env?.ELEVENLABS_VOICE_ID
    ?? (globalThis as any).ELEVENLABS_VOICE_ID;

  if (!elKey || !elVoice) {
    return new Response(JSON.stringify({ error: 'ElevenLabs not configured' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let text: string;
  try {
    const body = await boundedJson(request, 16384);
    if (typeof body.text !== 'string' || body.text.length > 4000) throw new InputError('Invalid text');
    text = body.text.trim();
  } catch (error) {
    return inputResponse(error, cors);
  }

  if (!text) {
    return new Response(JSON.stringify({ error: 'Empty text' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
  const elRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'xi-api-key':   elKey,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.2 },
      }),
    },
  );

  if (!elRes.ok) {
    console.error('[api/tts] Provider status', elRes.status);
    return new Response(JSON.stringify({ error: `ElevenLabs ${elRes.status}` }), {
      status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const audio = await elRes.arrayBuffer();
  return new Response(audio, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type':  'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
  } catch {
    return new Response(JSON.stringify({ error: 'Speech generation failed' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}
