/**
 * Platypus AI endpoint — server-side proxy to the Anthropic Messages API.
 *
 * The API key NEVER ships to the browser and is NEVER committed: it is read
 * from the ANTHROPIC_API_KEY environment variable configured in Vercel
 * (Project → Settings → Environment Variables). This file is safe in a
 * public repo because it contains no secret.
 *
 * Routes (single function, switch on body.kind):
 *   - GET                      → health/status (is the key configured?)
 *   - POST {kind:"summary"}    → generate a study summary from structured fields
 *   - POST {kind:"congruency"} → compare two field sets, list mismatches (future)
 */

const MODELS = {
  fast: "claude-haiku-4-5-20251001",
  balanced: "claude-sonnet-4-6",
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const key = process.env.ANTHROPIC_API_KEY;

  if (req.method === "GET") {
    return res.status(200).json({ configured: Boolean(key), models: MODELS });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!key) {
    return res.status(503).json({
      error: "AI isn't configured yet. An admin needs to add an Anthropic API key in the deployment settings.",
      configured: false,
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const kind = body.kind || "summary";
  const modelKey = body.model === "balanced" ? "balanced" : "fast";
  const model = MODELS[modelKey];

  let system = "";
  let user = "";

  if (kind === "summary") {
    const f = body.fields || {};
    system =
      "You are a clinical research startup analyst. Write a tight, factual study summary for a coordinator who needs the gist in 15 seconds. " +
      "3–4 sentences, plain English, no markdown, no preamble, no bullet points. " +
      "Lead with phase + design + indication + sponsor. Note enrollment target and anything operationally notable (pharmacy, imaging, central lab, vulnerable populations). " +
      "If a field is missing, simply omit it — never say 'not provided' or invent values.";
    user =
      "Summarize this study from its structured fields:\n\n" +
      Object.entries(f)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
  } else if (kind === "congruency") {
    system =
      "You are a clinical research QA reviewer. Compare two sources of the same study's data and list only genuine mismatches as short bullet-free sentences. If everything agrees, reply exactly: No discrepancies found.";
    user = "Source A (protocol):\n" + JSON.stringify(body.a || {}) + "\n\nSource B (entered):\n" + JSON.stringify(body.b || {});
  } else {
    return res.status(400).json({ error: "Unknown request kind." });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("anthropic error", r.status, detail);
      return res.status(502).json({ error: "The AI service returned an error. Try again in a moment." });
    }
    const data = await r.json();
    const text = (data.content || []).map((b) => b.text || "").join("").trim();
    return res.status(200).json({ text, model });
  } catch (e) {
    console.error("ai-summary failed", e);
    return res.status(502).json({ error: "Couldn't reach the AI service. Check your connection and retry." });
  }
}
