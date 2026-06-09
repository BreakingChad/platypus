-- 0041_team_handoffs.sql
-- Handoffs target a STAGE + a TEAM. The receiving work lands in a shared team
-- queue any member of that team can pick up, at the chosen stage — instead of
-- routing to a single role. Role-based handoffs (handoff_to_role_id) still work
-- for anything already configured that way.

alter table public.workflow_task_templates
  add column if not exists handoff_to_team_id   uuid references public.teams(id) on delete set null,
  add column if not exists handoff_to_stage_key text;

alter table public.tasks
  add column if not exists assigned_to_team_id  uuid references public.teams(id) on delete set null,
  add column if not exists handoff_to_team_id   uuid references public.teams(id) on delete set null,
  add column if not exists handoff_to_stage_key text;

create index if not exists tasks_team_idx on public.tasks (org_id, assigned_to_team_id);
