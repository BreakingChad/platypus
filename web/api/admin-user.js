/**
 * Platypus platform endpoint — temp-password issuance (Wave M2).
 *
 * The service-role key NEVER ships to the browser and is NEVER committed:
 * it is read from SUPABASE_SERVICE_ROLE_KEY configured in Vercel
 * (Project → Settings → Environment Variables). Safe in a public repo.
 *
 * POST { email, orgId, tier }  (Authorization: Bearer <caller's access token>)
 *   → caller must be a platform admin (public.platform_admins)
 *   → creates the user (or rotates their password) with a generated temp
 *     password, flags user_metadata.must_reset_password, attaches them to
 *     the org at the tier, points default_org_id at it, records the invite.
 *   → returns { tempPassword } — shown to the developer exactly once.
 *
 * GET → { configured } (is the service key present?)
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
}

const TIERS = new Set(["owner", "admin", "member", "developer"]);

function tempPassword() {
  // Readable, phone-dictation-friendly: platypus-XXXX-XXXX (no 0/O/1/l).
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n) =>
    Array.from(crypto.randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join("");
  return `platypus-${pick(4)}-${pick(4)}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (req.method === "GET") {
    return res.status(200).json({ configured: Boolean(url && serviceKey) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!url || !serviceKey) {
    return res.status(503).json({
      error:
        "Temp passwords aren't configured yet — add SUPABASE_SERVICE_ROLE_KEY in the deployment environment (Vercel → Settings → Environment Variables).",
    });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- authenticate + authorize the CALLER --------------------------------
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in first." });
  const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !callerData?.user) return res.status(401).json({ error: "Session expired — sign in again." });
  const caller = callerData.user;

  const { data: pa } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", caller.id)
    .maybeSingle();
  if (!pa) return res.status(403).json({ error: "Platform admins only." });

  // ---- input ----------------------------------------------------------------
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const email = String(body?.email ?? "").trim().toLowerCase();
  const orgId = String(body?.orgId ?? "");
  const tier = String(body?.tier ?? "member");
  if (!/.+@.+\..+/.test(email)) return res.status(400).json({ error: "Valid email required." });
  if (!orgId) return res.status(400).json({ error: "orgId required." });
  if (!TIERS.has(tier)) return res.status(400).json({ error: "Invalid tier." });

  const password = tempPassword();

  // ---- create or rotate -------------------------------------------------------
  let userId = null;
  let created = false;
  const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_reset_password: true },
  });

  if (!createErr && createdUser?.user) {
    userId = createdUser.user.id;
    created = true;
  } else {
    // Probably exists — find via profiles mirror, rotate their password.
    const { data: prof } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (!prof?.id) {
      return res.status(500).json({
        error: createErr?.message ?? "Couldn't create the user.",
      });
    }
    userId = prof.id;
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { must_reset_password: true },
    });
    if (updErr) return res.status(500).json({ error: updErr.message });
  }

  // ---- attach to the org -----------------------------------------------------
  // (createUser fired handle_new_user; these are idempotent corrections that
  // make the routing deterministic regardless of trigger timing.)
  await admin
    .from("org_invites")
    .upsert(
      { org_id: orgId, email, tier, invited_by: caller.id, accepted_at: new Date().toISOString() },
      { onConflict: "org_id,email" }
    );
  const { error: memErr } = await admin
    .from("org_members")
    .upsert({ org_id: orgId, user_id: userId, tier }, { onConflict: "org_id,user_id" });
  if (memErr) return res.status(500).json({ error: memErr.message });
  await admin.from("profiles").upsert(
    { id: userId, email, default_org_id: orgId },
    { onConflict: "id" }
  );

  return res.status(200).json({ tempPassword: password, created, email });
}
