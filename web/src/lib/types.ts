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
  created_at: string;
  updated_at: string;
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
