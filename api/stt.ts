import { boundedBody, inputResponse } from '../lib/api-input.js';
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

  const apiKey = (globalThis as any).process?.env?.OPENAI_API_KEY
    ?? (globalThis as any).OPENAI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not set' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let formData: FormData;
  try {
    const body = await boundedBody(request, 6 * 1024 * 1024);
    formData = await new Response(body.slice().buffer, { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } }).formData();
  } catch (error) {
    return inputResponse(error, cors);
  }

  const audio = formData.get('audio') as File | null;
  if (!(audio instanceof File) || audio.size === 0 || audio.size > 5 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'No audio field' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const whisperForm = new FormData();
  whisperForm.append('file', audio);
  whisperForm.append('model', 'whisper-1');
  whisperForm.append('language', 'fr');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body:    whisperForm,
    });

    if (!res.ok) {
      console.error('[api/stt] Provider status', res.status);
      throw new Error(`Whisper ${res.status}`);
    }

    const data: any = await res.json();
    return new Response(JSON.stringify({ text: data.text ?? '' }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[api/stt] Provider request failed');
    return new Response(JSON.stringify({ error: 'Transcription failed' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}
