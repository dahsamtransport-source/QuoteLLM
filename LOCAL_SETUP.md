# Local development

Requires Node.js 22+.

```sh
cd web
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Vite now runs the repository's actual API handlers;
it does not forward requests to another application on port 3000.
The chart and MCP tools work without paid provider credentials.

Put `OPENAI_API_KEY`, and optionally `ELEVENLABS_API_KEY` and
`ELEVENLABS_VOICE_ID`, in the repository root `.env.local`, then restart Vite.
Do not prefix secret names with `VITE_`, commit them, or send them in chat.
Without provider credentials the chat/OCR/STT services are unavailable.
This development server binds to loopback and is not a production server.

Vercel continues to use `vercel.json` and the Edge API files independently.
