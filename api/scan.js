/* FIELDWRX "What's in your way": forwards a visitor's lines (humps, slow work, things they want time for) to Claude and returns the JSON read.
   Environment variables (set in Vercel → Project → Settings → Environment Variables):
     ANTHROPIC_API_KEY   required
     KV_REST_API_URL / KV_REST_API_TOKEN   added automatically by the Upstash for Redis integration;
                                           used for the per-visitor limit (3 scans an hour)
     SCAN_DAILY_CAP      optional, total scans a day across all visitors (default 300) */
const crypto = require("crypto");

const PER_HOUR = 3;
const DAILY_CAP = parseInt(process.env.SCAN_DAILY_CAP || "300", 10);
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map(); // fallback only: per server instance, so weaker than Redis

async function redis(cmds) {
  const r = await fetch(REDIS_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map((x) => x.result);
}

/* returns true when this visitor may scan now, and records the scan */
async function allow(visitor) {
  const now = Date.now(), cutoff = now - 3600e3;
  const day = new Date(now + 2 * 3600e3).toISOString().slice(0, 10); // Cape Town date
  if (REDIS_URL && REDIS_TOKEN) {
    const key = "fwx:scan:" + visitor, dayKey = "fwx:scan:day:" + day;
    const [, count, total] = await redis([
      ["ZREMRANGEBYSCORE", key, "0", String(cutoff)],
      ["ZCARD", key],
      ["GET", dayKey],
    ]);
    if (count >= PER_HOUR) return "rate";
    if (parseInt(total || "0", 10) >= DAILY_CAP) return "busy";
    await redis([
      ["ZADD", key, String(now), now + ":" + Math.random().toString(36).slice(2, 8)],
      ["EXPIRE", key, "3700"],
      ["INCR", dayKey],
      ["EXPIRE", dayKey, "90000"],
    ]);
    return "ok";
  }
  const hits = (memory.get(visitor) || []).filter((t) => t > cutoff);
  if (hits.length >= PER_HOUR) return "rate";
  hits.push(now); memory.set(visitor, hits);
  return "ok";
}

function buildPrompt(tasks) {
  const list = tasks.map((t, i) => i + 1 + ". " + t).join("\n");
  return "You help small South African businesses and teams with what gets in the way of their work. Each line below is one of three things: a hump they want to get over or around, something slow they want to speed up, or something they can't find time for. For each line give a first read with one verdict: keep (worth its effort as it is), automate (software can take the repetitive part), simplify (fewer steps, people or waiting), or stop (it no longer needs doing). When a line is something they want time for, choose the verdict for what to clear or change to make that time, and say what in the how. Be practical and kind. Never judge the person. Use plain South African English, no jargon, no product names unless very common (Excel, WhatsApp, Google Forms). Estimate hours a week each change could give back for one person, as a cautious range of whole or half hours; keep is 0. If a line isn't about work, treat it as keep with hours [0,0] and how \"Not something we can read\".\n\nReply with only JSON in this shape:\n{\"tasks\":[{\"task\":\"short name, max 6 words\",\"verdict\":\"automate\",\"how\":\"one sentence, max 18 words, on what would change\",\"hours\":[1,2]}],\"summary\":\"one sentence, max 22 words, on what that time could go to\"}\n\nLines:\n" + list;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const fail = (code, error) => res.status(code).send(JSON.stringify({ error }));
  if (req.method !== "POST") return fail(405, "method");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const tasks = (Array.isArray(body && body.tasks) ? body.tasks : [])
    .map((t) => String(t).replace(/<[^>]*>/g, "").trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 10);
  if (!tasks.length) return fail(400, "empty");
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "config");

  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "x").split(",")[0].trim();
  const visitor = crypto.createHash("sha256").update("fwx" + ip).digest("hex").slice(0, 32); // no raw IPs stored
  let gate;
  try { gate = await allow(visitor); } catch (e) { gate = "ok"; console.error("limit store", e.message); }
  if (gate === "rate") return fail(429, "rate");
  if (gate === "busy") return fail(503, "busy");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages: [{ role: "user", content: buildPrompt(tasks) }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { console.error("anthropic", r.status, (await r.text()).slice(0, 300)); return fail(502, "upstream"); }
    const text = ((await r.json()).content || [])[0]?.text || "";
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    let json = null;
    try { json = a > -1 && b > a ? JSON.parse(text.slice(a, b + 1)) : null; } catch (e) {}
    if (!json) return fail(502, "parse");
    return res.status(200).send(JSON.stringify(json));
  } catch (e) {
    console.error("scan", e.message);
    return fail(502, "upstream");
  }
};
