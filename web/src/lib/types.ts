/**
 * Generated database types — placeholder.
 *
 * Real types will be generated from the live Supabase schema via:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/types.ts
 *
 * For now this is a minimal shape so the client compiles. Replace once
 * Phase B lands and the schema is finalized.
 */
export type Database = {
  public: {
    Tables: {
      orgs: {
        Row: {
          id: string;
          name: string;
          slug: string | null;
          sponsor_mode: "site" | "sponsor";
          region: string | null;
          timezone: string | null;
          project_id_prefix: string | null;
          owner_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["orgs"]["Row"]> & { name: string; owner_id: string };
        Update: Partial<Database["public"]["Tables"]["orgs"]["Row"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          title: string | null;
          phone: string | null;
          default_org_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string; email: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      org_members: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          tier: "owner" | "admin" | "member";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["org_members"]["Row"]> & { org_id: string; user_id: string };
        Update: Partial<Database["public"]["Tables"]["org_members"]["Row"]>;
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {
      sponsor_mode: "site" | "sponsor";
      member_tier: "owner" | "admin" | "member";
    };
  };
};
