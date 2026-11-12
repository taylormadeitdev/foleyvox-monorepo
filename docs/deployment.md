# Deployment notes

## Render

Create a Blueprint using this repository's `render.yaml`. Set the same environment variables on the API and worker:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side secret only)
- `GEMINI_API_KEY`
- `FRONTEND_ORIGIN` (one or more comma-separated exact origins)

The web service runs Flask/Gunicorn. The worker polls Supabase. Start with one worker instance: this first MVP's polling loop is not an atomic distributed queue and must not be horizontally scaled.

## Supabase

Create private Storage buckets named `manuscripts` and `renders`. The API and worker use the service-role key on the server. Browser code must use a Supabase publishable key and the signed-in user's access token. Never put the service-role key in Floot or any browser bundle.

The worker expects `projects.manuscript_path`, `projects.error_message`, `chapters.title`, `chapters.status`, `chapters.error_message`, `chapters.audio_path`, and `chapters.duration_seconds`. See `supabase-schema.sql`.

## Processing flow

1. Frontend creates a project row and uploads the manuscript to `manuscripts/{user_id}/{project_id}/{filename}`.
2. Frontend calls `POST /api/upload` with project ID and path plus its Supabase bearer token.
3. Worker polls `projects.status=queued`, analyzes chapters with Gemini, persists JSON blueprints, then renders each chapter.
4. Worker uploads MP3 files to the private `renders` bucket and marks chapters ready.
5. API returns temporary signed URLs to authorized project owners.

## Current MVP limitations

- Polling is intentionally single-worker/single-instance; implement atomic job claiming with a Postgres RPC or a real queue before scaling.
- SFX are mixed only if the matching MP3 already exists in the worker's `sfx/` directory. Freesound search/download, licensing metadata, and attribution are not implemented.
- Chapter input is capped by `MAX_CHAPTER_CHARS` for each Gemini request. Long chapters should be chunked semantically in a later iteration.
- Edge TTS is an external online service; validate its terms, voice availability, and suitability for commercial use.
- Gemini blueprints are AI-generated and should be reviewed before publication.
- Re-render currently rerenders the stored blueprint; it does not re-run manuscript analysis.
- The sample API uses Supabase service role internally only after validating the bearer token and checking project ownership. Keep all privileged credentials in Render.
