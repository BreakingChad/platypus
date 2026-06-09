/**
 * Generated database types — placeholder.
 *
 * Real types will be generated from the live Supabase schema via:
 *   npx supabase gen types typescript --project-id <ref> > web/src/lib/types.ts
 *
 * Until then this hand-maintained skeleton is enough to make the client typed.
 */
export type FieldType = "text" | "date" | "number" | "dropdown" | "multiselect" | "list" | "boolean" | "person" | "lookup" | "json";
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

export type PipelineRow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: string;       // active | archived
  position: number;
  created_at: string;
  updated_at: string;
};

export type PipelineStageRow = {
  id: string;
  org_id: string;
  /** Which pipeline this stage belongs to. NULL = the universal intake stage,
   *  shared by every pipeline (studies start there before they're committed). */
  pipeline_id: string | null;
  key: string;
  label: string;
  icon_key: string;
  color: string;
  target_days: number;
  owner_team_id: string | null;
  terminal: boolean;
  is_core: boolean;
  position: number;
  parallel_group?: number | null;
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
  /** Team-wide contact address for notifications (0020). */
  group_email: string | null;
  /** Site ids this team covers; empty array = all sites (0020). */
  site_ids: unknown;
  /** { max_level, assign_level } — level boxes + who manages assignments (0020). */
  level_settings: unknown;
  created_at: string;
};

export type TeamRoleRow = {
  id: string;
  org_id?: string | null;
  team_id: string;
  access_role_id?: string | null;
  title: string;
  hierarchy_key: HierarchyKey;
  level: number;
  position: number;
  created_at: string;
};

export type TeamRoleHolderRow = {
  id: string;
  org_id?: string | null;
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
  /** Team-queue routing (0041): a task any member of this team can pick up. */
  assigned_to_team_id?: string | null;
  site_id?: string | null;
  /** Handoff tasks: the role that receives the work (0021). */
  handoff_to_role_id: string | null;
  /** Team handoffs (0041): the team + stage the work hands off to. */
  handoff_to_team_id?: string | null;
  handoff_to_stage_key?: string | null;
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
  workstream_id: string | null;
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
  /** Handoff templates: the role that receives the work (0021). */
  handoff_to_role_id: string | null;
  /** Team handoffs (0041): the team + stage the work hands off to. */
  handoff_to_team_id?: string | null;
  handoff_to_stage_key?: string | null;
  position: number;
  created_at: string;
};

export type PlatformAdminRow = {
  user_id: string;
  created_at: string;
};

export type OrgInviteRow = {
  id: string;
  org_id: string;
  email: string;
  tier: MemberTier;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
};

export type WorkstreamRow = {
  id: string;
  org_id: string;
  /** The pipeline this work stream belongs to (0040). A work stream inherits
   *  its pipeline's stages and adds the tasks + teams for each. */
  pipeline_id: string | null;
  name: string;
  description: string | null;
  status: string;       // active | archived
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type StudySiteRow = {
  id: string;
  org_id: string;
  study_id: string;
  site_id: string;
  is_primary: boolean;
  site_status: string;   // selected | activated | closed
  pi_name: string | null;               // legacy free-text (0032), kept for back-compat
  pi_investigator_id: string | null;    // 0033 — source of truth
  activated_date: string | null;
  note: string | null;
  created_at: string;
};

export type StartupDocumentRow = {
  id: string;
  org_id: string;
  study_id: string;
  bucket: string;       // operations | regulatory | startup
  track: string;        // original | amendment
  title: string;
  note: string | null;
  status: string;       // staged | filed | archived
  disposition: string | null;  // binder | site_file | archived
  filed_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type IntakeFormRow = {
  id: string;
  org_id: string;
  title: string;
  scope: string;
  description: string | null;
  /** draft | active | inactive | archived */
  status: string;
  slug: string;
  version: number;
  copied_from: string | null;
  /** FormFieldSnapshot[] — frozen at activation (lib/forms.ts). */
  fields: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FormSubmissionRow = {
  id: string;
  org_id: string;
  form_id: string;
  form_title: string;
  /** new | committed | declined */
  status: string;
  values: Record<string, unknown>;
  submitter_name: string | null;
  submitter_email: string | null;
  study_id: string | null;
  declined_at: string | null;
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

export type SiteRow = {
  id: string;
  org_id: string;
  name: string;
  status: string;
  city: string | null;
  state: string | null;
  country: string | null;
  profile: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvestigatorRow = {
  id: string;
  org_id: string;
  name: string;
  degree: string | null;
  email: string | null;
  phone: string | null;
  npi: string | null;
  license_number: string | null;
  license_state: string | null;
  status: string;                       // active | inactive
  cv_on_file: boolean;
  cv_date: string | null;
  form_1572_on_file: boolean;
  financial_disclosure_on_file: boolean;
  gcp_training_date: string | null;
  gcp_training_expires: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SponsorRow = {
  id: string;
  org_id: string;
  name: string;
  sponsor_type: string | null;       // industry | nih | foundation | investigator_initiated | other
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  portal_url: string | null;
  payment_terms: string | null;
  notes: string | null;
  status: string;                    // active | inactive
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CroRow = {
  id: string;
  org_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkstreamStageRow = {
  id: string;
  org_id: string;
  workstream_id: string;
  stage_key: string;
  position: number;
  parallel_group: number | null;
  target_days: number;
  terminal: boolean;
  created_at: string;
  updated_at: string;
};

export type SiteInvestigatorRow = {
  id: string;
  org_id: string;
  site_id: string;
  investigator_id: string;
  is_primary: boolean;
  created_at: string;
};

export type StudyNoteRow = {
  id: string;
  org_id: string;
  study_id: string;
  body: string;
  author_id: string | null;
  author_email: string | null;
  created_at: string;
};

export type StudyRow = {
  id: string;
  org_id: string;
  code: string;
  title: string;
  nct: string | null;
  sponsor: string | null;            // legacy free text — kept as fallback
  sponsor_id?: string | null;        // 0037 — source of truth
  cro_id?: string | null;            // 0037
  therapeutic_area: string | null;
  phase: string | null;
  stage_key: string | null;
  study_kind: string | null;
  priority: string;
  intake_status: string;
  committed_at: string | null;
  site_id: string | null;
  feasibility?: Record<string, unknown>;
  stage_entered_at: string | null;
  intake_date: string | null;
  closed: boolean;
  closed_at: string | null;
  pi_name: string | null;
  custom_field_values: Record<string, unknown>;
  workstream_id?: string | null;
  root_study_id?: string | null;
  amendment_of?: string | null;
  version_label?: string | null;
  amendment_purpose?: string | null;
  superseded_at?: string | null;
  superseded_by?: string | null;
  ai_summary?: string | null;
  ai_summary_at?: string | null;
  ai_summary_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type OrgRow = {
  id: string; name: string; slug: string | null;
  sponsor_mode: SponsorMode; region: string | null; timezone: string | null;
  project_id_prefix: string | null; owner_id: string; created_at: string;
  ai_enabled?: boolean; ai_model?: string;
};

export type ProfileRow = {
  id: string; email: string; full_name: string | null; title: string | null;
  phone: string | null; default_org_id: string | null; created_at: string;
  /** 0042 — split identity + photo. Optional so pre-migration DBs still type-check. */
  first_name?: string | null; last_name?: string | null; avatar_url?: string | null;
};

/** Preferred display name: "First Last" → legacy full_name → email. */
export function displayName(
  p: Pick<ProfileRow, "email" | "full_name" | "first_name" | "last_name"> | null | undefined
): string {
  if (!p) return "";
  const fl = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return fl || p.full_name || p.email || "";
}

export type OrgMemberRow = {
  id: string; org_id: string; user_id: string;
  tier: MemberTier; created_at: string;
  access_role_id?: string | null;
  ooo_until?: string | null;
  ooo_delegate_user_id?: string | null;
};

/** Lightweight Database type. Add tables as we go. */
export type Database = {
  public: {
    Tables: {
      orgs:              { Row: OrgRow;              Insert: Partial<OrgRow>;              Update: Partial<OrgRow>;              Relationships: [] };
      profiles:          { Row: ProfileRow;          Insert: Partial<ProfileRow>;          Update: Partial<ProfileRow>;          Relationships: [] };
      org_members:       { Row: OrgMemberRow;        Insert: Partial<OrgMemberRow>;        Update: Partial<OrgMemberRow>;        Relationships: [] };
      field_definitions: { Row: FieldDefinitionRow;  Insert: Partial<FieldDefinitionRow>;  Update: Partial<FieldDefinitionRow>;  Relationships: [] };
      pipelines:         { Row: PipelineRow;           Insert: Partial<PipelineRow>;         Update: Partial<PipelineRow>;         Relationships: [] };
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
      sites:                   { Row: SiteRow;                 Insert: Partial<SiteRow>;                 Update: Partial<SiteRow>;                 Relationships: [] };
      study_notes:             { Row: StudyNoteRow;            Insert: Partial<StudyNoteRow>;            Update: Partial<StudyNoteRow>;            Relationships: [] };
      document_versions:       { Row: DocumentVersionRow;      Insert: Partial<DocumentVersionRow>;      Update: Partial<DocumentVersionRow>;      Relationships: [] };
      intake_forms:            { Row: IntakeFormRow;           Insert: Partial<IntakeFormRow>;           Update: Partial<IntakeFormRow>;           Relationships: [] };
      startup_documents:       { Row: StartupDocumentRow;      Insert: Partial<StartupDocumentRow>;      Update: Partial<StartupDocumentRow>;      Relationships: [] };
      study_sites:             { Row: StudySiteRow;            Insert: Partial<StudySiteRow>;            Update: Partial<StudySiteRow>;            Relationships: [] };
      investigators:           { Row: InvestigatorRow;         Insert: Partial<InvestigatorRow>;         Update: Partial<InvestigatorRow>;         Relationships: [] };
      site_investigators:      { Row: SiteInvestigatorRow;     Insert: Partial<SiteInvestigatorRow>;     Update: Partial<SiteInvestigatorRow>;     Relationships: [] };
      workstreams:             { Row: WorkstreamRow;           Insert: Partial<WorkstreamRow>;           Update: Partial<WorkstreamRow>;           Relationships: [] };
      workstream_stages:       { Row: WorkstreamStageRow;      Insert: Partial<WorkstreamStageRow>;      Update: Partial<WorkstreamStageRow>;      Relationships: [] };
      sponsors:                { Row: SponsorRow;              Insert: Partial<SponsorRow>;              Update: Partial<SponsorRow>;              Relationships: [] };
      cros:                    { Row: CroRow;                  Insert: Partial<CroRow>;                  Update: Partial<CroRow>;                  Relationships: [] };
      platform_admins:         { Row: PlatformAdminRow;        Insert: Partial<PlatformAdminRow>;        Update: Partial<PlatformAdminRow>;        Relationships: [] };
      org_invites:             { Row: OrgInviteRow;            Insert: Partial<OrgInviteRow>;            Update: Partial<OrgInviteRow>;            Relationships: [] };
      form_submissions:        { Row: FormSubmissionRow;       Insert: Partial<FormSubmissionRow>;       Update: Partial<FormSubmissionRow>;       Relationships: [] };
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
