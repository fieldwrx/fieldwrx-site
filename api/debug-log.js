/* Temporary store for ?debug=1 scroll logs (see /debuglog.js). Logs expire after 7 days.
   POST  JSON log          -> { id }
   GET   ?list=1           -> the 20 most recent { id, at, device }
   GET   ?id=<id>          -> one log
   Uses the same Upstash Redis as the scanner. Limited to 12 posts an hour per visitor and 600 KB a log. */
const crypto = require("crypto");
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const WEEK = 7 * 24 * 3600;

async function redis(cmds) {
  const r = await fetch(URL_ + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map((x) => x.result);
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const out = (code, o) => res.status(code).send(JSON.stringify(o));
  if (!URL_ || !TOKEN) return out(503, { error: "store" });
  try {
    if (req.method === "GET") {
      if (req.query.list) {
        const ids = (await redis([["LRANGE", "fwx:dbg:index", "0", "19"]]))[0] || [];
        return out(200, { logs: ids.map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean) });
      }
      const id = String(req.query.id || "").replace(/[^a-z0-9]/g, "").slice(0, 16);
      if (!id) return out(400, { error: "id" });
      const v = (await redis([["GET", "fwx:dbg:" + id]]))[0];
      return v ? res.status(200).send(v) : out(404, { error: "missing" });
    }
    if (req.method !== "POST") return out(405, { error: "method" });
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (raw.length > 600000) return out(413, { error: "size" });
    let log; try { log = JSON.parse(raw); } catch (e) { return out(400, { error: "json" }); }
    if (!log || log.v !== 1 || !Array.isArray(log.page)) return out(400, { error: "shape" });
    const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
    const who = crypto.createHash("sha256").update("fwx-dbg" + ip).digest("hex").slice(0, 24);
    const [n] = await redis([["INCR", "fwx:dbg:rate:" + who], ["EXPIRE", "fwx:dbg:rate:" + who, "3600"]]);
    if (n > 12) return out(429, { error: "rate" });
    const id = crypto.randomBytes(4).toString("hex");
    const ua = String(log.ua || "");
    const device = (/(iPhone|iPad|Android)/.exec(ua) || ["desktop"])[0] + " " + (log.vw || "?") + "x" + (log.vh || "?") + " " + (log.pointer || "");
    await redis([
      ["SET", "fwx:dbg:" + id, raw, "EX", String(WEEK)],
      ["LPUSH", "fwx:dbg:index", JSON.stringify({ id, at: new Date().toISOString(), device })],
      ["LTRIM", "fwx:dbg:index", "0", "49"],
      ["EXPIRE", "fwx:dbg:index", String(WEEK)],
    ]);
    return out(200, { id });
  } catch (e) {
    console.error("debug-log", e.message);
    return out(502, { error: "store" });
  }
};
