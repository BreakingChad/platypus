/**
 * Generated database types — placeholder.
 *
 * Real types will be generated from the live Supabase schema via:
 *   npx supabase gen types typescript --project-id <ref> > web/src/lib/types.ts
 *
 * Until then this hand-maintained skeleton is enough to make the client typed.
 */
export type FieldType = "text" | "date" | "number" | "dropdown" | "boolean" | "person" | "lookup" | "json";
export type FieldKind = "standard" | "custom";
export type FieldEditTier = "admin" | "coordinator" | "any";
export type HierarchyKey = "director" | "manager" | "coordinator" | "specialist" | "support";
export type SponsorMode = "site" | "sponsor";
export type MemberTier = "owner" | "admin" | "developer" | "member";

export type FieldDefinitionRow = {
  id: string;
  org_id: string;
  entity_type: string;
  key: string;
  label: string;
  section: string;
  field_type: FieldType;
  kind: FieldKind;
  enabled: boolean;
  required: boolean;
  lock_after_commit: boolean;
  edit_tier: FieldEditTier;
  position: number;
  options: unknown | null;
  created_at: string;
  updated_at: string;
};

export type PipelineStageRow = {
  id: string;
  org_id: string;
  key: string;
  label: string;
  icon_key: string;
  color: string;
  target_days: number;
  owner_team_id: string | null;
  terminal: boolean;
  is_core: boolean;
  position: number;
  created_at: string;
};

export type TeamRow = {
  id: string;
  org_id: string;
  name: string;
  color: string;
  charter: string | null;
  status: string;
  position: number;
  created_at: string;
};

export type TeamRoleRow = {
  id: string;
  team_id: string;
  title: string;
  hierarchy_key: HierarchyKey;
  level: number;
  position: number;
  created_at: string;
};

export type TeamRoleHolderRow = {
  id: string;
  team_role_id: string;
  user_id: string;
  created_at: string;
};

export type AccessRoleRow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  builtin: boolean;
  modules: Record<string, "read" | "edit" | "admin">;
  portfolio_scope: string;
  ta_scope: string[];
  site_scope: string[];
  function_overrides: Record<string, unknown>;
  admin_scope: string[];
  status: string;
  former_names: string[];
  nav: unknown;            // NavGroupConfig[] — typed at use sites
  page_layouts: unknown;   // PageLayoutsConfig — typed at use sites
  created_at: string;
  updated_at: string;
};

export type AuditEventRow = {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  payload: Record<string, unknown>;
  prev_hash: string | null;
  event_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type TaskStatus = "open" | "in_progress" | "done" | "skipped" | "cancelled";
export type TaskKind = "date" | "handoff" | "escalation" | "external_handoff" | "manual";

export type TaskRow = {
  id: string;
  org_id: string;
  study_id: string | null;
  stage_key: string | null;
  kind: TaskKind;
  document_id: string | null;
  action_type: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  due_at: string | null;
  assigned_to_user_id: string | null;
  assigned_to_role_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowModuleRow = {
  id: string;
  org_id: string;
  stage_key: string;
  owner_team_id: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowTaskTemplateRow = {
  id: string;
  module_id: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  due_offset_days: number | null;
  assigned_to_role_id: string | null;
  position: number;
  created_at: string;
};

export type DocumentStatus = "draft" | "active" | "superseded" | "archived";

export type DocumentRow = {
  id: string;
  org_id: string;
  study_id: string;
  category: string;
  doc_type: string;
  doc_type_code: string | null;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  current_version_id: string | null;
  status: DocumentStatus | string;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentVersionRow = {
  id: string;
  document_id: string;
  version_label: string;
  file_path: string;
  original_filename: string | null;
  file_size: number;
  mime_type: string | null;
  metadata: Record<string, unknown>;
  uploaded_by: string | null;
  uploaded_at: string;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
};

export type StudyRow = {
  id: string;
  org_id: string;
  code: string;
  title: string;
  nct: string | null;
  sponsor: string | null;
  therapeutic_area: string | null;
  phase: string | null;
  stage_key: string | null;
  study_kind: string | null;
  priority: string;
  intake_status: string;
  committed_at: string | null;
  stage_entered_at: string | null;
  intake_date: string | null;
  closed: boolean;
  closed_at: string | null;
  pi_name: string | null;
  custom_field_values: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OrgRow = {
  id: string; name: string; slug: string | null;
  sponsor_mode: SponsorMode; region: string | null; timezone: string | null;
  project_id_prefix: string | null; owner_id: string; created_at: string;
};

export type ProfileRow = {
  id: string; email: string; full_name: string | null; title: string | null;
  phone: string | null; default_org_id: string | null; created_at: string;
};

export type OrgMemberRow = {
  id: string; org_id: string; user_id: string;
  tier: MemberTier; created_at: string;
  access_role_id?: string | null;
};

/** Lightweight Database type. Add tables as we go. */
export type Database = {
  public: {
    Tables: {
      orgs:              { Row: OrgRow;              Insert: Partial<OrgRow>;              Update: Partial<OrgRow>;              Relationships: [] };
      profiles:          { Row: ProfileRow;          Insert: Partial<ProfileRow>;          Update: Partial<ProfileRow>;          Relationships: [] };
      org_members:       { Row: OrgMemberRow;        Insert: Partial<OrgMemberRow>;        Update: Partial<OrgMemberRow>;        Relationships: [] };
      field_definitions: { Row: FieldDefinitionRow;  Insert: Partial<FieldDefinitionRow>;  Update: Partial<FieldDefinitionRow>;  Relationships: [] };
      pipeline_stages:   { Row: PipelineStageRow;    Insert: Partial<PipelineStageRow>;    Update: Partial<PipelineStageRow>;    Relationships: [] };
      studies:           { Row: StudyRow;            Insert: Partial<StudyRow>;            Update: Partial<StudyRow>;            Relationships: [] };
      teams:             { Row: TeamRow;             Insert: Partial<TeamRow>;             Update: Partial<TeamRow>;             Relationships: [] };
      team_roles:        { Row: TeamRoleRow;         Insert: Partial<TeamRoleRow>;         Update: Partial<TeamRoleRow>;         Relationships: [] };
      team_role_holders: { Row: TeamRoleHolderRow;   Insert: Partial<TeamRoleHolderRow>;   Update: Partial<TeamRoleHolderRow>;   Relationships: [] };
      access_roles:      { Row: AccessRoleRow;       Insert: Partial<AccessRoleRow>;       Update: Partial<AccessRoleRow>;       Relationships: [] };
      audit_events:      { Row: AuditEventRow;       Insert: Partial<AuditEventRow>;       Update: Partial<AuditEventRow>;       Relationships: [] };
      tasks:             { Row: TaskRow;             Insert: Partial<TaskRow>;             Update: Partial<TaskRow>;             Relationships: [] };
      workflow_modules:        { Row: WorkflowModuleRow;       Insert: Partial<WorkflowModuleRow>;       Update: Partial<WorkflowModuleRow>;       Relationships: [] };
      workflow_task_templates: { Row: WorkflowTaskTemplateRow; Insert: Partial<WorkflowTaskTemplateRow>; Update: Partial<WorkflowTaskTemplateRow>; Relationships: [] };
      documents:               { Row: DocumentRow;             Insert: Partial<DocumentRow>;             Update: Partial<DocumentRow>;             Relationships: [] };
      document_versions:       { Row: DocumentVersionRow;      Insert: Partial<DocumentVersionRow>;      Update: Partial<DocumentVersionRow>;      Relationships: [] };
    };
    Views: {};
    Functions: {};
    Enums: {
      sponsor_mode: SponsorMode;
      member_tier: MemberTier;
      field_type: FieldType;
      field_kind: FieldKind;
      field_edit_tier: FieldEditTier;
      hierarchy_key: HierarchyKey;
    };
  };
};
