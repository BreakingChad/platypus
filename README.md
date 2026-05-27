<p align="center">
  <img src="platypus_logo.png" width="120" alt="Platypus" />
</p>

<h1 align="center">Platypus</h1>

<p align="center">
  <strong>The operating system for clinical research site operations — from intake to closeout.</strong>
</p>

---

## Why Platypus exists

Platypus exists because clinical research sites deserve better. Startup
assessments, regulatory filing, budget negotiation, study activation — the
work that actually shapes studies was living in emails, meetings, and
spreadsheets. That gap shouldn't exist.

We built Platypus differently. Instead of optimizing for sponsors, we
optimized for sites. We believe the people running research need software
built from the ground up for their complexity, not bolt-on solutions
designed for someone else.

**One system. One workflow. From intake to closeout.** Everything flows
together because startup decisions inform your regulatory approach, budget
constraints shape your timeline, and nothing falls through the cracks.

We're building for the people who power clinical research.

## Repository layout

```
platypus/
├── platypus.html              ← demo build, single-file React + Babel,
├── platypus.jsx                  no backend, persists to localStorage.
├── web/                       ← THE REAL APP — Vite + React + TS + Supabase.
│   ├── src/...                   Schema-driven, multi-tenant, RLS-secured.
│   └── README.md
├── supabase/                  ← Database schema + migrations.
│   ├── migrations/0001_initial.sql
│   └── README.md
├── platypus_logo.{svg,png}
└── platypus_cover.{svg,png}
```

**Two builds in this repo.** `platypus.html` is the original
single-file React demo — open it directly in a browser, no install. The
`web/` folder is the real Supabase-backed product being built around the
same brand and patterns. As `web/` reaches feature parity, the demo file
becomes a marketing artifact.

## Run the demo (no install)

```bash
open platypus.html
```

## Run the real app

```bash
cd web
cp .env.example .env.local       # paste your Supabase URL + publishable key
npm install
npm run dev                       # http://localhost:5173
```

Then apply the initial migration in Supabase Studio (see `supabase/README.md`).

## Brand

Why "Platypus"? Because the platypus is the animal that combines traits
everyone said couldn't coexist. Clinical research software made the opposite
bet — a separate system for every part of the job, with email holding it
together. We think it belongs together.

Colors: indigo `#4F46E5` → violet `#7C3AED`.

---

© Platypus. All rights reserved.
