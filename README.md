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

## What's inside

Platypus is a single integrated platform that replaces the spreadsheets,
email threads, and disconnected systems clinical research sites use today.

- **Study lifecycle** — intake → triage → committed-to-portfolio →
  pipeline → activated → closeout, with amendments as parallel instances.
- **Documents (TMF / ISF)** — the CDISC reference model, with 21 CFR Part 11
  e-signatures and a hash-chained audit trail.
- **Workflows you design** — your team builds its own pipeline stages,
  workflows, role-based teams, and study fields on first login. The app
  runs on the operating model you build, not one we impose.
- **One operating view** — Today, Inbox, Portfolio, Pipeline, Documents in
  one shell. No app-switching.

## Running it

This release is a single-file React app with Babel-standalone for in-browser
JSX. No build step. No backend. State persists to `localStorage`.

```bash
# clone
git clone https://github.com/BreakingChad/platypus.git
cd platypus

# open in a browser
open platypus.html
```

Two files do the work:

- **`platypus.jsx`** — the source. ~25k lines, single-file React.
- **`platypus.html`** — the loadable. Mirrors the JSX inside a
  `<script type="text/babel">` block plus the React + Babel CDN.

`platypus.html` is generated from `platypus.jsx`. To rebuild:

```bash
head -44 platypus.html > /tmp/sync.html
cat platypus.jsx >> /tmp/sync.html
printf "  </script>\n</body>\n</html>\n" >> /tmp/sync.html
cp /tmp/sync.html platypus.html
```

## Tech

- **React 18** via UMD CDN (no bundler).
- **Babel-standalone** for in-browser JSX transform.
- **No backend** in this build — every piece of state persists to
  `localStorage` under the `tapestry_v3_*` keys. Reset from
  **Settings → Reset demo data**.

## Status

Early-stage. Configuration is the centerpiece — the team designing its own
pipeline, workflows, roles, and fields. Onboarding is being redesigned around
that thesis (see the in-app first-run wizard).

## Brand

Why "Platypus"? Because the platypus is the animal that combines traits
everyone said couldn't coexist. Clinical research software made the opposite
bet — a separate system for every part of the job, with email holding it
together. We think it belongs together.

Brand colors: indigo `#4F46E5` → violet `#7C3AED`.
Brand assets: `platypus_logo.svg`, `platypus_cover.svg`.

---

© Platypus. All rights reserved.
