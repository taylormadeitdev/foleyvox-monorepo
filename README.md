# FoleyVox Backend

Python backend for the FoleyVox manuscript-to-audio-drama MVP.

## Included

- `app.py` — authenticated Flask API (health, upload queue, project/chapter retrieval, voice preview, re-render).
- `worker.py` — Render background worker that polls Supabase and runs analysis/rendering.
- `preflight.py` — chapter splitting and Gemini JSON blueprint generation.
- `deduplicate.py` — character identity cleanup using Gemini.
- `master_render.py` — Edge TTS voice generation, optional local SFX mixing, and FFmpeg stitching.
- `requirements.txt`, `render.yaml`, `.env.example`.
- `docs/supabase-schema.sql` — additive schema and policy reference.
- `docs/deployment.md` — deployment and operational notes.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in the secrets, then:
python app.py
# In another process:
python worker.py
```

FFmpeg and ffprobe must be installed on the host.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, create a new Blueprint and select this repository.
3. Add the required secret environment variables to both services.
4. Apply the additive SQL in `docs/supabase-schema.sql` only after reviewing your current Supabase schema and policies.
5. Configure the Floot frontend with the API URL and Supabase publishable key.

## Security

- The Supabase service-role key is only read from server environment variables.
- API routes require a Supabase access token and verify project ownership.
- Both Storage buckets are private; API returns short-lived signed URLs.
- Restrict `FRONTEND_ORIGIN` to your exact deployed Floot origin(s).

## MVP limitations

See `docs/deployment.md`. In particular, run only one worker instance until queue claiming is made atomic; SFX discovery/download and attribution are not yet implemented.
