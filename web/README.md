# Platypus — Web

The real app. Vite + React 18 + TypeScript + Tailwind + Supabase.

## First-time setup

```bash
cd web
cp .env.example .env.local
# edit .env.local — paste your VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm install
```

## Apply the database schema

Before the app can sign anyone in, the Supabase project needs the initial
schema applied. See `../supabase/README.md` for the click-by-click. The TL;DR:

1. Open Supabase Studio → SQL Editor → New query
2. Paste `supabase/migrations/0001_initial.sql`
3. Run

Then in **Authentication → URL Configuration**, add `http://localhost:5173` to
the Site URL and Additional Redirect URLs so magic-link sign-in returns here.

## Run

```bash
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # serve the production build locally
```

## Where things live

```
src/
├── main.tsx              entry
├── App.tsx               <AuthGate><Welcome /></AuthGate>
├── auth/
│   ├── AuthGate.tsx      blocks until signed in
│   ├── MagicLinkForm.tsx email → magic link
│   └── useAuth.ts        session state hook
├── lib/
│   ├── supabase.ts       the shared client
│   └── types.ts          generated DB types (regenerated after migrations)
├── pages/
│   └── Welcome.tsx       protected landing — proves a live DB read works
└── styles/globals.css    Tailwind entry
```

## Next steps (Phase B)

- Schema migrations for `pipeline_stages`, `teams`, `workflows`,
  `studies` (with `custom_field_values` JSONB), `field_definitions`,
  `page_flow_definitions`, `audit_log`, `documents`, `notifications`.
- Generic `useOrgTable<T>(table, opts)` hook — Supabase-backed replacement
  for the demo app's `usePersisted`. Realtime subscriptions, optimistic
  updates, RLS-aware.
- Port the demo's components (Pipeline funnel, Stage Designer, Field
  Designer, Workflow Builder) from `platypus.jsx` into this app, reading
  through `useOrgTable` instead of `localStorage`.
