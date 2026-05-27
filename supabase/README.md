# Platypus — Supabase

The database lives in Supabase. This folder holds migrations and
schema-generation helpers.

## Project

- URL: see `web/.env.example`
- Key model: publishable + secret. The publishable key is what the browser
  app uses (with RLS enforcing security). Never ship the secret key.

## Applying a migration

### Option A — Supabase Studio (easiest, no CLI)

1. Open your project at https://supabase.com/dashboard
2. Left sidebar → **SQL Editor** → **New query**
3. Paste the entire contents of the next un-applied migration file
   (e.g. `0001_initial.sql`)
4. Click **Run**. You should see `Success. No rows returned.`

### Option B — Supabase CLI (recommended for repeatable deploys)

```bash
# one-time
npm install -g supabase
supabase login

# link the local repo to your project
cd platypus
supabase link --project-ref gdwtrezpvdklsjynuqua

# push pending migrations
supabase db push
```

## Generating TypeScript types

After every migration, regenerate the typed client:

```bash
npx supabase gen types typescript \
  --project-id gdwtrezpvdklsjynuqua \
  > web/src/lib/types.ts
```

(Add `--schema public` if you ever introduce extra schemas.)

## Migrations

| File | Adds |
|---|---|
| `0001_initial.sql` | `orgs`, `profiles`, `org_members`, RLS policies, signup trigger. |

(Future migrations: `pipeline_stages`, `teams`, `workflows`, `studies` with
`custom_field_values` JSONB, `field_definitions`, `page_flow_definitions`,
`audit_log` with hash-chained columns, `documents`, `notifications`.)
