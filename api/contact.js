/* FIELDWRX booking form: emails a visitor's request for the free 30-minute call, via Resend.
   Environment variables (Vercel → Project → Settings → Environment Variables):
     RESEND_API_KEY   required, from resend.com → API Keys
     CONTACT_TO       required, the inbox that receives requests
     CONTACT_FROM     optional, default "FIELDWRX <onboarding@resend.dev>". Resend's test sender only delivers
                      to the email address the Resend account was opened with; once fieldwrx.co.za is verified
                      in Resend, set this to e.g. "FIELDWRX <hello@fieldwrx.co.za>".
     KV_REST_API_URL / KV_REST_API_TOKEN   from the Upstash integration; limits each visitor to 3 requests an hour
   Accepts JSON (the page's script) or a plain form post (no JavaScript), which is sent back to /#book. */
const crypto = require("crypto");

const PER_HOUR = 3;
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map(); // fallback only: per server instance

async function redis(cmds) {
  const r = await fetch(REDIS_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map((x) => x.result);
}

async function allow(visitor) {
  const now = Date.now(), cutoff = now - 3600e3;
  if (REDIS_URL && REDIS_TOKEN) {
    const key = "fwx:contact:" + visitor;
    const [, count] = await redis([["ZREMRANGEBYSCORE", key, "0", String(cutoff)], ["ZCARD", key]]);
    if (count >= PER_HOUR) return false;
    await redis([["ZADD", key, String(now), now + ":" + Math.random().toString(36).slice(2, 8)], ["EXPIRE", key, "3700"]]);
    return true;
  }
  const hits = (memory.get(visitor) || []).filter((t) => t > cutoff);
  if (hits.length >= PER_HOUR) return false;
  hits.push(now); memory.set(visitor, hits);
  return true;
}

const one = (v, max) => String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").replace(/<[^>]*>/g, "").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = Object.fromEntries(new URLSearchParams(body)); } }
  body = body || {};
  const plain = !String(req.headers["content-type"] || "").includes("json"); // a form post without JavaScript

  const reply = (code, payload) => {
    if (plain) {
      res.statusCode = 303;
      res.setHeader("Location", payload.ok ? "/?sent=1#book" : "/?err=" + encodeURIComponent(payload.error || "upstream") + "#book");
      return res.end();
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.status(code).send(JSON.stringify(payload));
  };
  if (req.method !== "POST") return reply(405, { error: "method" });

  /* bots: a filled hidden field, or a form sent within 2.5 seconds of the page loading. Treated as sent, so they learn nothing. */
  const t = parseInt(body.t, 10);
  if (one(body.website, 200) || (t && Date.now() - t < 2500)) return reply(200, { ok: true });

  const name = one(body.name, 80), email = one(body.email, 120), org = one(body.org, 80);
  const message = String(body.message == null ? "" : body.message).replace(/<[^>]*>/g, "").trim().slice(0, 2000);
  const fields = {};
  if (!name) fields.name = "Add your name so we know who we’re replying to.";
  if (!EMAIL.test(email)) fields.email = "That email looks incomplete. Check it has an @ and a domain, like name@company.co.za.";
  if (message.length < 10) fields.message = "Add a line or two about what you’re working towards.";
  if (Object.keys(fields).length) return reply(400, { error: "invalid", fields });

  if (!process.env.RESEND_API_KEY || !process.env.CONTACT_TO) return reply(503, { error: "config" });

  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "x").split(",")[0].trim();
  const visitor = crypto.createHash("sha256").update("fwx-contact" + ip).digest("hex").slice(0, 32); // no raw IPs stored
  let ok;
  try { ok = await allow(visitor); } catch (e) { ok = true; console.error("limit store", e.message); }
  if (!ok) return reply(429, { error: "rate" });

  const text = [
    "New request for a free 30-minute call, from the FIELDWRX site.",
    "",
    "Name: " + name,
    "Email: " + email,
    org ? "Team or business: " + org : null,
    "",
    "What they're working towards:",
    message,
    "",
    "Reply to this email to answer them directly.",
  ].filter((l) => l !== null).join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM || "FIELDWRX <onboarding@resend.dev>",
        to: process.env.CONTACT_TO.split(",").map((s) => s.trim()).filter(Boolean),
        reply_to: email,
        subject: "Free 30-minute call: " + name + (org ? " (" + org + ")" : ""),
        text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.error("resend", r.status, (await r.text()).slice(0, 300)); return reply(502, { error: "upstream" }); }
    return reply(200, { ok: true });
  } catch (e) {
    console.error("contact", e.message);
    return reply(502, { error: "upstream" });
  }
};
