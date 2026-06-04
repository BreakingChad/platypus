# Platypus — The Admin Control Surface

**As of:** 2026-06-03 · `7993ef9` · production READY on Vercel
**What this is:** the one-pager for "an admin controls every aspect of the app" — what's controllable, from where, and how it resolves. Demo-ready talking points included.

---

## The model in one sentence

Admins shape the app per **access role** in the designers; users in that role see the result **live on save** — their own preferences still win where it matters.

```
Access role (jsonb: nav + page_layouts)
   ├─ nav            → sidebar groups/items        (Nav designer)
   └─ page_layouts   → per page:
        ├─ blocks[]  → placed blocks, each with region: top | bottom + settings
        ├─ tabs[]    → tab order / rename / hide   (pages with tabs, e.g. Study record)
        └─ options{} → page defaults for the role  (filters, default tab, view mode, columns)
```

No migration was needed for any of this — it all rides `access_roles.page_layouts` (jsonb). Legacy saved layouts (bare arrays) normalize transparently.

---

## What an admin controls today, and where

| Surface | What's controllable | Where |
|---|---|---|
| **Sidebar** | Groups, items, order, visibility per role | Nav designer |
| **Home** | Fully block-driven (order, settings, hide) | Page designer |
| **Intake / Studies / Pipeline / Sites / Inbox / Audit feed** | Any block placed **above or below** the page's built-in content | Page designer |
| **Study record** | Tab order, **rename**, hide (≥1 stays visible); default tab per role; blocks above/below the record | Page designer |
| **Studies list** | Default health filter + show-closed; **show/hide Health / PI / Created columns** | Page designer → Studies → Page defaults |
| **Pipeline** | Default view (**Columns** or **By stage**) + show-closed | Page designer → Pipeline → Page defaults |
| **Inbox** | Default queue (Mine / Team / All) | Page designer → Inbox → Page defaults |
| **Overview field sections** | Sections, order, required fields (org-wide) | Field designer (linked from the Page designer) |
| **Pipeline stages** | Stages, colors, targets, terminal flags | Stage designer |
| **Teams & roles** | Teams, role slots (linked to Access Roles), hierarchy | Team builder |
| **Permissions & layouts** | The access roles themselves | Access roles |

**Block library (13+):** KPI strip, work tiles, my studies, tasks due, pulse, quick start, setup hub, **open escalations**, **intake queue**, **site coverage**, and more — any block on any page, per role.

---

## Resolution rules (the part that makes it safe)

1. **User preference > role default > app fallback.** Role defaults seed a user's sticky filters only until that user makes their own choice. Admins set starting points, not handcuffs.
2. **Built-in page content is locked.** Blocks arrange *around* it (the locked grey anchor in the designer canvas). No role can configure away the portfolio list or the task queue.
3. **At least one study tab stays visible.** The designer refuses to hide the last one.
4. **Unknown blocks render as nothing.** Old clients with newer saved layouts degrade silently.
5. **Live on save.** Layouts are realtime-subscribed; users see changes without reloading.

---

## Preview as role

From the Page designer toolbar: **Preview as role** → the entire app (sidebar + every page) renders as that role sees it, with a floating "Previewing as X — Exit preview" pill. Session-local; nothing is written; your admin permissions remain (it's a layout preview, not impersonation).

**Demo move:** build the Coordinator's layout on screen, hit Preview, and say *"this is what your coordinators log into."*

---

## Demo-relevant extras shipped alongside

- **Pipeline "By stage" view** — the 05/29 "is scroll our optimal view?" question, answered with both options; per-role default, user-switchable.
- **Stage palette keyed to team ownership** — Startup's four stages are the cool family (indigo/violet/blue/cyan); Budgets amber; Regulatory emerald; Clinical Ops pink. The board reads by owner at a glance.
- **`seedDemoStory()`** — demo seeding now stages the narrative automatically: 3 believable notes on the hero study, an **overdue budget escalation**, a completed + an open handoff, and vacation coverage (other member OOO → delegated to you). The "system noticing things" beat works on a fresh org.
- **Feasibility: 3 of 4 pillars real** — Understanding (M11), Challenges (Acuity), and now **Resource** (workforce snapshot with OOO chips + the linked site's capability profile). Assessment awaits the qualification-form decision.

---

## What's still parked (needs Chad)

1. **Document Congruency** — definition (what's checked against what; what a mismatch looks like).
2. **Site Qualification Forms** — model from an existing template, or design from scratch?
3. **Portfolio-scope AND combinator** — scope model decision.
4. **Demo date** — calibrates how much more Phase B makes the cut.
5. **Supabase access token** — unlocks generated DB types (retiring ~93 `as any`).
6. **Email notifications** — Edge Function needs a `service_role` deploy.
