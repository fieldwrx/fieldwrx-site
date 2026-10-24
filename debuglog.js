/* FIELDWRX scroll logger. Loaded only with ?debug=1.
   Records how this visitor scrolls (wheel steps, touch, keys, page position) and what How we work
   does frame by frame (scroll target, eased position, which full-screen title is playing and for how long),
   then sends it to /api/debug-log when the bottom of the page is reached, or when Send is pressed.
   Keeps no personal data beyond the browser string and screen size. Stored logs expire after 7 days. */
(function () {
  if (!/[?&]debug=1/.test(location.search)) return;
  var T0 = performance.now(), t = function () { return Math.round(performance.now() - T0); }, CAP = 20000;
  var L = {
    v: 1, start: new Date().toISOString(), ua: navigator.userAgent,
    vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
    pointer: matchMedia("(pointer:fine)").matches ? "fine" : "coarse",
    lenis: document.documentElement.classList.contains("lenis"),
    wheel: [], touch: [], keys: [], page: [], how: [], geo: null
  };
  var push = function (a, row) { if (a.length < CAP) a.push(row); };
  addEventListener("wheel", function (e) { push(L.wheel, [t(), Math.round(e.deltaY * 10) / 10, e.deltaMode]); }, { passive: true });
  addEventListener("touchstart", function (e) { push(L.touch, [t(), "s", Math.round(e.touches[0].clientY)]); }, { passive: true });
  addEventListener("touchmove", function (e) { push(L.touch, [t(), "m", Math.round(e.touches[0].clientY)]); }, { passive: true });
  addEventListener("touchend", function () { push(L.touch, [t(), "e", 0]); }, { passive: true });
  addEventListener("keydown", function (e) { if (/Page|Arrow|Space|Home|End/.test(e.code)) push(L.keys, [t(), e.code]); });
  var last = -99;
  (function tick() { var n = t(); if (n - last >= 33) { last = n; push(L.page, [n, Math.round(scrollY)]); } requestAnimationFrame(tick); })();
  /* called by the How we work loop every frame it runs: [ms, target, eased, title playing (-1 none), title seconds, stage] */
  window.__howdbg = function (s) { push(L.how, [t(), +s.tg.toFixed(4), +s.c.toFixed(4), s.k, s.e < 0 ? -1 : +s.e.toFixed(2), s.si]); };
  function geo() {
    var tr = document.querySelector(".how-track"), w = document.getElementById("work");
    if (!tr) return null;
    return { trackTop: Math.round(tr.getBoundingClientRect().top + scrollY), trackH: tr.offsetHeight, workTop: Math.round(w.getBoundingClientRect().top + scrollY), docH: document.documentElement.scrollHeight, vh: innerHeight };
  }

  var pill = document.createElement("div");
  pill.setAttribute("style", "position:fixed;left:12px;bottom:72px;z-index:9999;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:999px;background:#0F1013;color:#F3F2EF;font:600 13px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)");
  pill.innerHTML = '<span id="dbg-t">● Recording your scroll</span><button id="dbg-b" type="button" style="appearance:none;border:0;border-radius:999px;padding:8px 12px;background:#2F5BFF;color:#fff;font:600 12px/1 system-ui,sans-serif;cursor:pointer">Send</button>';
  document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(pill); L.geo = geo(); });
  if (document.readyState !== "loading") { document.body.appendChild(pill); L.geo = geo(); }

  var sent = false;
  function send() {
    if (sent) return; sent = true;
    L.geo = geo() || L.geo; L.ms = t();
    var label = document.getElementById("dbg-t"), btn = document.getElementById("dbg-b");
    label.textContent = "Sending…"; btn.disabled = true;
    fetch("/api/debug-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(L) })
      .then(function (r) { return r.json(); })
      .then(function (j) { label.textContent = j.id ? "Sent ✓  " + j.id : "Couldn’t send"; btn.textContent = "Again"; btn.disabled = false; sent = false; if (!j.id) sent = false; })
      .catch(function () { label.textContent = "Couldn’t send"; btn.disabled = false; sent = false; });
  }
  pill.addEventListener("click", function (e) { if (e.target.id === "dbg-b") send(); });
  var auto = false;
  addEventListener("scroll", function () {
    if (auto) return;
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 6) { auto = true; setTimeout(send, 1500); }
  }, { passive: true });
})();
