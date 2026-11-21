export class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Count received bytes, not a caller-controlled Content-Length header.
export async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) throw new InputError('Missing body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new InputError('Request timeout', 408)), 5000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new InputError('Body too large', 413);
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function boundedJson(request: Request, limit = 65536): Promise<Record<string, unknown>> {
  let value: unknown;
  const bytes = await boundedBody(request, limit);
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new InputError('Invalid JSON body'); }
  if (!record(value)) throw new InputError('Expected an object');
  return value;
}

export function inputResponse(error: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: error instanceof InputError ? error.message : 'Invalid request' }), {
    status: error instanceof InputError ? error.status : 400,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const slotKeys = new Set(['date_of_birth', 'regime', 'family_composition', 'hospitalization_need', 'optics_need', 'dental_need', 'current_price', 'current_insurer', 'currently_insured']);
export function validSlots(value: unknown): value is Record<string, string | boolean | null> {
  return record(value) && Object.entries(value).every(([key, entry]) => slotKeys.has(key) &&
    (entry === null || (key === 'currently_insured' ? typeof entry === 'boolean' : typeof entry === 'string' && entry.length <= 200)));
}

export function validMessages(value: unknown): value is { role: 'user' | 'assistant'; content: string }[] {
  return Array.isArray(value) && value.length <= 40 && value.every(message => record(message) &&
    Object.keys(message).every(key => key === 'role' || key === 'content') &&
    (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content.length <= 4000);
}
