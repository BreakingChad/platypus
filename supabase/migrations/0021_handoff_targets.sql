-- 0021: role-to-role handoffs within a module (Wave F4).
-- A handoff task template names the role that RECEIVES the work. The engine
-- copies the target onto the spawned task; completing the handoff task
-- auto-creates the receipt task for the receiving role. Idempotent.
alter table public.workflow_task_templates
  add column if not exists handoff_to_role_id uuid references public.team_roles(id) on delete set null;
alter table public.tasks
  add column if not exists handoff_to_role_id uuid references public.team_roles(id) on delete set null;
