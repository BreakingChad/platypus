-- 0018: AI features — study summaries + org-level enable/model.
-- Idempotent. The Anthropic API key is NOT stored here; it lives only as a
-- server environment variable (Vercel) read by /api/ai-summary.

alter table public.studies add column if not exists ai_summary text;
alter table public.studies add column if not exists ai_summary_at timestamptz;
alter table public.studies add column if not exists ai_summary_by uuid;

alter table public.orgs add column if not exists ai_enabled boolean not null default true;
alter table public.orgs add column if not exists ai_model text not null default 'fast';
