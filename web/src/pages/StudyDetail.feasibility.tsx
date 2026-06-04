import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import {
  M11_SECTIONS,
  ACUITY_DIMENSIONS,
  ACUITY_STANDARDS,
  acuityCategoryFor,
  feasibilityOf,
  ingestDemoM11,
  saveAcuity,
  type M11Data,
  type AcuityData,
} from "../lib/feasibility";
import type { StudyRow, TaskRow, SiteRow, FieldDefinitionRow, OrgMemberRow } from "../lib/types";
import { useOrgTable } from "../lib/useOrgTable";
import { supabase } from "../lib/supabase";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";

/** FeasibilityTab — two of the four pillars, production-grade:
 *    UNDERSTANDING — the M11 structured protocol accordion. Coordinators
 *      stop hunting through 80-page PDFs; the protocol reads as 11 sections.
 *    CHALLENGES — manual trial-acuity scoring (6 dimensions, 1–5). Deliberately
 *      human-scored: clinical judgment over a model, AI-assist on the roadmap.
 *  (Resource + Assessment pillars land with workforce/site-qualification.)
 */
export function FeasibilityTab({ study }: { study: StudyRow }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const feas = feasibilityOf(study);
  const [m11, setM11] = useState<M11Data | null>((feas.m11 as M11Data) ?? null);
  const [openSection, setOpenSection] = useState<string | null>("1");
  const [ingesting, setIngesting] = useState(false);

  const existingAcuity = (feas.acuity as AcuityData) ?? null;
  const [scores, setScores] = useState<Record<string, number>>(
    existingAcuity?.scores ??
      ACUITY_DIMENSIONS.reduce<Record<string, number>>((a, d) => ({ ...a, [d.id]: 0 }), {})
  );
  const [notes, setNotes] = useState(existingAcuity?.notes ?? "");
  const [standard, setStandard] = useState(existingAcuity?.standard ?? "opal");
  const [savingAcuity, setSavingAcuity] = useState(false);
  const [savedAcuity, setSavedAcuity] = useState<AcuityData | null>(existingAcuity);

  const total = useMemo(
    () => Object.values(scores).reduce((a, v) => a + (v || 0), 0),
    [scores]
  );
  const filled = useMemo(
    () => Object.values(scores).filter((v) => v > 0).length,
    [scores]
  );
  const cat = acuityCategoryFor(total);

  const ingest = async () => {
    if (!orgId || !userId) return;
    setIngesting(true);
    try {
      const data = await ingestDemoM11({ orgId, study, actorUserId: userId, actorEmail: userEmail });
      setM11(data);
      toast.success(stamped("Protocol ingested — 11 M11 sections structured"));
    } catch (e: any) {
      toast.error(e?.message || "Ingestion failed. Has migration 0015 been applied?");
    } finally {
      setIngesting(false);
    }
  };

  const doSaveAcuity = async () => {
    if (!orgId || !userId) return;
    if (filled < ACUITY_DIMENSIONS.length) {
      toast.error("Score every dimension first (1–5 each)");
      return;
    }
    setSavingAcuity(true);
    try {
      const saved = await saveAcuity({
        orgId, study, scores, notes, standard,
        actorUserId: userId, actorEmail: userEmail,
      });
      setSavedAcuity(saved);
      toast.success(stamped(`Acuity saved — ${saved.total}/30 (${saved.category})`));
    } catch (e: any) {
      toast.error(e?.message || "Save failed. Has migration 0015 been applied?");
    } finally {
      setSavingAcuity(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ───────────── UNDERSTANDING — M11 ───────────── */}
      <section>
        <PillarHeading
          icon="file"
          pillar="Understanding"
          title="M11 structured protocol"
          sub="ICH M11 Common Protocol Template — the protocol as 11 navigable sections instead of an 80-page PDF."
        />
        {!m11 ? (
          <Card>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                <Icon name="file" size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-slate-900">No protocol ingested yet</div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed max-w-xl">
                  Upload an M11 export (.docx / XML) and Platypus structures it into the 11
                  standard sections — eligibility, schedule of activities, safety, statistics —
                  searchable and citable. Document upload ingestion is in the pipeline; the demo
                  ingestion below seeds a complete Phase III oncology protocol.
                </p>
                {isAdmin && (
                  <Button className="mt-3" variant="primary" onClick={ingest} disabled={ingesting}>
                    <Icon name="plus" size={12} /> {ingesting ? "Ingesting…" : "Ingest demo protocol"}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <Card flush>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
              <Icon name="file" size={14} className="text-brand-600" />
              <span className="text-sm font-semibold text-slate-900 truncate">{m11.fileName}</span>
              <Pill tone="brand">M11 v1.0</Pill>
              <span className="flex-1" />
              <span className="text-[10px] font-mono text-slate-400">
                ingested {new Date(m11.ingestedAt).toLocaleDateString()}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {M11_SECTIONS.map((s) => {
                const content = m11.sections[s.id];
                const open = openSection === s.id;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setOpenSection(open ? null : s.id)}
                      aria-expanded={open}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition"
                    >
                      <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0 text-[10px] font-mono font-bold">
                        {s.id}
                      </span>
                      <span className="flex-1 text-sm font-semibold text-slate-800">{s.label}</span>
                      <Icon
                        name={open ? "chevron-down" : "chevron-right"}
                        size={13}
                        className="text-slate-400"
                      />
                    </button>
                    {open && content && (
                      <div className="px-4 pb-4 pl-[52px]">
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                          {content.body}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      {/* ───────────── CHALLENGES — Trial acuity ───────────── */}
      <section>
        <PillarHeading
          icon="layers"
          pillar="Challenges"
          title="Trial acuity"
          sub="Six dimensions, scored 1–5 by the team that knows the protocol. Sizes resourcing and budget against complexity — deliberately human-scored."
        />
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Standard</span>
              <select
                value={standard}
                onChange={(e) => setStandard(e.target.value)}
                disabled={!isAdmin}
                className="text-xs rounded-lg border border-slate-200 px-2 py-1 bg-white focus:outline-none focus:border-brand-500"
                aria-label="Acuity scoring standard"
              >
                {Object.entries(ACUITY_STANDARDS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-display font-extrabold text-slate-900 tabular-nums">
                {total}
                <span className="text-sm font-bold text-slate-400">/30</span>
              </span>
              {filled === ACUITY_DIMENSIONS.length && <Pill tone={cat.tone}>{cat.label}</Pill>}
            </div>
          </div>

          <div className="space-y-3">
            {ACUITY_DIMENSIONS.map((d) => (
              <div key={d.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{d.label}</div>
                  <div className="text-[11px] text-slate-500">{d.desc}</div>
                </div>
                <div className="flex items-center gap-1" role="radiogroup" aria-label={d.label}>
                  {[1, 2, 3, 4, 5].map((v) => {
                    const active = scores[d.id] === v;
                    return (
                      <button
                        key={v}
                        role="radio"
                        aria-checked={active}
                        disabled={!isAdmin}
                        onClick={() => setScores((p) => ({ ...p, [d.id]: v }))}
                        className={
                          "w-9 h-9 rounded-lg border text-sm font-bold transition " +
                          (active
                            ? "bg-brand-gradient text-white border-transparent shadow-sm"
                            : "bg-white text-slate-600 border-slate-200 hover:border-brand-300 disabled:opacity-50")
                        }
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Scoring notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!isAdmin}
              rows={2}
              placeholder="Context behind the scores — e.g. tight eligibility, heavy imaging burden."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition resize-y disabled:bg-slate-50"
            />
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
            {savedAcuity ? (
              <span className="text-[11px] text-slate-500">
                Last scored {new Date(savedAcuity.scoredAt).toLocaleString()} ·{" "}
                {savedAcuity.scoredByEmail ?? "—"} · {savedAcuity.standardLabel}
              </span>
            ) : (
              <span className="text-[11px] text-slate-400 italic">Not scored yet.</span>
            )}
            {isAdmin && (
              <Button
                variant="primary"
                onClick={doSaveAcuity}
                disabled={savingAcuity || filled < ACUITY_DIMENSIONS.length}
                title={filled < ACUITY_DIMENSIONS.length ? "Score every dimension first" : undefined}
              >
                {savingAcuity ? "Saving…" : "Save acuity score"}
              </Button>
            )}
          </div>
        </Card>
      </section>

      {/* ───────────── RESOURCE — workforce + site capability ───────────── */}
      <ResourcePillar study={study} />

      {/* ───────────── Coming pillar ───────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ComingPillar
          icon="check"
          pillar="Assessment"
          title="Site qualification forms"
          sub="Sponsor questionnaires answered once from the site's own data — document congruency ties it together."
        />
      </div>
    </div>
  );
}

/* ───────────────────── RESOURCE pillar ───────────────────── */

/** Can this team absorb this study, and can this site run it?
 *  Left: workforce snapshot — every member's open/overdue load, with
 *  vacation coverage surfaced (OOO → delegate). Right: the linked site's
 *  capability read — profile completeness + the filled capability fields.
 */
function ResourcePillar({ study }: { study: StudyRow }) {
  const members = useOrgTable<OrgMemberRow>("org_members", { orderBy: "created_at" });
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "created_at" });
  const sites = useOrgTable<SiteRow>("sites", { orderBy: "name" });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const [profiles, setProfiles] = useState<Record<string, { full_name: string | null; email: string | null }>>({});

  useEffect(() => {
    const ids = members.rows.map((m) => m.user_id).filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ids);
      if (cancelled) return;
      const byId: Record<string, { full_name: string | null; email: string | null }> = {};
      for (const p of (data ?? []) as any[]) byId[p.id] = { full_name: p.full_name, email: p.email };
      setProfiles(byId);
    })();
    return () => {
      cancelled = true;
    };
  }, [members.rows.map((m) => m.user_id).join(",")]);

  const now = Date.now();
  const nameOf = (uid: string | null): string => {
    if (!uid) return "—";
    const p = profiles[uid];
    return p?.full_name || p?.email || "Member";
  };

  const workforce = members.rows.map((m) => {
    const mine = tasks.rows.filter(
      (t) => t.assigned_to_user_id === m.user_id && t.status !== "done"
    );
    const overdue = mine.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
    const ooo = m.ooo_until && new Date(m.ooo_until).getTime() > now;
    return { m, open: mine.length, overdue: overdue.length, ooo };
  });

  const site = study.site_id ? sites.rows.find((s) => s.id === study.site_id) ?? null : null;
  const siteFields = fields.rows.filter((f) => f.entity_type === "site" && f.enabled);
  const SITE_COL: Record<string, keyof SiteRow> = {
    siteName: "name", city: "city", state: "state", country: "country", siteStatus: "status",
  };
  const valueOf = (f: FieldDefinitionRow): unknown => {
    if (!site) return null;
    const col = SITE_COL[f.key];
    return col ? (site as any)[col] : ((site.profile ?? {}) as any)[f.key];
  };
  const filledFields = siteFields
    .map((f) => ({ f, v: valueOf(f) }))
    .filter(({ v }) => v !== null && v !== undefined && v !== "");
  const fillPct = siteFields.length
    ? Math.round((filledFields.length / siteFields.length) * 100)
    : 0;

  return (
    <section>
      <PillarHeading
        icon="users"
        pillar="Resource"
        title="Workforce & site capability"
        sub="Can the team absorb this study — and can the site run it? Live load per member (vacation coverage included) next to the site's own capability profile."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        {/* Workforce */}
        <Card flush className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Workforce snapshot
          </div>
          {workforce.length === 0 ? (
            <div className="px-4 py-6 text-xs text-slate-400 italic">No members yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {workforce.map(({ m, open, overdue, ooo }) => (
                <li key={m.user_id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">
                      {nameOf(m.user_id)}
                    </span>
                    {ooo && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-0.5">
                        <Icon name="clock" size={10} />
                        OOO until {new Date(m.ooo_until!).toLocaleDateString()}
                        {m.ooo_delegate_user_id && <> → {nameOf(m.ooo_delegate_user_id)}</>}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                    {open} open
                  </span>
                  {overdue > 0 && (
                    <Pill tone="danger">{overdue} overdue</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Site capability */}
        <Card flush className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Site capability
            </span>
            {site && (
              <span className="flex items-center gap-1.5">
                <span className="w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <span
                    className={
                      "block h-full rounded-full " +
                      (fillPct >= 80 ? "bg-emerald-500" : fillPct >= 40 ? "bg-amber-500" : "bg-slate-300")
                    }
                    style={{ width: `${fillPct}%` }}
                  />
                </span>
                <span className="text-[10px] font-mono text-slate-500">{fillPct}% profiled</span>
              </span>
            )}
          </div>
          {!site ? (
            <div className="px-4 py-6 text-xs text-slate-500">
              No site linked to this study yet — set one in the{" "}
              <a href="#/sites" className="font-semibold text-brand-700 hover:underline">
                Sites module
              </a>{" "}
              to read capability here.
            </div>
          ) : (
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="hospital" size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-900">{site.name}</span>
                <span className="text-[11px] text-slate-500">
                  {[site.city, site.state].filter(Boolean).join(", ")}
                </span>
              </div>
              {filledFields.length === 0 ? (
                <div className="text-xs text-slate-400 italic">
                  Profile is empty — fill it from the Sites module.
                </div>
              ) : (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {filledFields.slice(0, 8).map(({ f, v }) => (
                    <div key={f.key} className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wider text-slate-400 font-bold truncate">
                        {f.label}
                      </dt>
                      <dd className="text-xs text-slate-800 truncate">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

function PillarHeading({
  icon,
  pillar,
  title,
  sub,
}: {
  icon: string;
  pillar: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
        <Icon name={icon} size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-700">
          {pillar}
        </div>
        <div className="text-base font-display font-bold text-slate-900 leading-tight">{title}</div>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed max-w-2xl">{sub}</p>
      </div>
    </div>
  );
}

function ComingPillar({
  icon,
  pillar,
  title,
  sub,
}: {
  icon: string;
  pillar: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-4 flex items-start gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0">
        <Icon name={icon} size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
          {pillar} · coming
        </div>
        <div className="text-sm font-display font-bold text-slate-600">{title}</div>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}
