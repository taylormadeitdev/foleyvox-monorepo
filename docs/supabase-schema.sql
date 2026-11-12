-- FoleyVox schema reference. Review existing project tables before applying.
-- This migration is additive and assumes public.projects and public.chapters exist.
alter table public.projects
  add column if not exists manuscript_path text,
  add column if not exists error_message text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.chapters
  add column if not exists title text,
  add column if not exists status text not null default 'pending',
  add column if not exists error_message text,
  add column if not exists audio_path text,
  add column if not exists duration_seconds double precision;

create unique index if not exists chapters_project_chapter_unique
  on public.chapters(project_id, chapter_number);

create index if not exists projects_status_created_idx
  on public.projects(status, created_at);

create index if not exists chapters_status_idx
  on public.chapters(status);

-- Private buckets; create through Supabase Storage dashboard if they do not exist.
insert into storage.buckets (id, name, public, file_size_limit)
values ('manuscripts', 'manuscripts', false, 52428800)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('renders', 'renders', false, 524288000)
on conflict (id) do nothing;

-- Ensure RLS is enabled and ownership policies exist. Review existing policies first.
alter table public.projects enable row level security;
alter table public.chapters enable row level security;

drop policy if exists "Users can view own FoleyVox projects" on public.projects;
create policy "Users can view own FoleyVox projects"
on public.projects for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own FoleyVox projects" on public.projects;
create policy "Users can create own FoleyVox projects"
on public.projects for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own FoleyVox projects" on public.projects;
create policy "Users can update own FoleyVox projects"
on public.projects for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can view chapters of own FoleyVox projects" on public.chapters;
create policy "Users can view chapters of own FoleyVox projects"
on public.chapters for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = chapters.project_id and p.user_id = (select auth.uid())
));

drop policy if exists "Users can update chapters of own FoleyVox projects" on public.chapters;
create policy "Users can update chapters of own FoleyVox projects"
on public.chapters for update to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = chapters.project_id and p.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.projects p
  where p.id = chapters.project_id and p.user_id = (select auth.uid())
));

-- Storage paths are expected to start with auth.uid()/project_id/.
drop policy if exists "Users upload own FoleyVox manuscripts" on storage.objects;
create policy "Users upload own FoleyVox manuscripts"
on storage.objects for insert to authenticated
with check (bucket_id = 'manuscripts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users read own FoleyVox manuscripts" on storage.objects;
create policy "Users read own FoleyVox manuscripts"
on storage.objects for select to authenticated
using (bucket_id = 'manuscripts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users read own FoleyVox renders" on storage.objects;
create policy "Users read own FoleyVox renders"
on storage.objects for select to authenticated
using (bucket_id = 'renders' and (storage.foldername(name))[1] = (select auth.uid())::text);
