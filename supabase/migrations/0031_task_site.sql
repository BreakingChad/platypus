-- 0031: optional site location on a task (Send-a-task). Idempotent.
alter table public.tasks add column if not exists site_id uuid references public.sites(id) on delete set null;
