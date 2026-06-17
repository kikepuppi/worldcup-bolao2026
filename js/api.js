/* =========================================================================
   api.js — data layer for the FIFA World Cup 2026 API (worldcup26.ir)
   The API is slow and occasionally drops connections, so every request
   retries with backoff, has a timeout, and results are cached per session.
   ========================================================================= */

const WC = (() => {
  const BASE = "https://worldcup26.ir";
  const TTL = 60 * 1000; // 60s — near real-time; a page reload past this refetches results
  const TIMEOUT = 25000;

  /* ---- low-level fetch with timeout + backoff retry ---- */
  async function fetchJSON(path, { retries = 4 } = {}) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
      try {
        const res = await fetch(BASE + path, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        // backoff: 0.6s, 1.2s, 1.8s …
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
      }
    }
    throw lastErr;
  }

  /* ---- session cache ---- */
  function cached(key) {
    try {
      const raw = sessionStorage.getItem("wc:" + key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > TTL) return null;
      return v;
    } catch { return null; }
  }
  function store(key, v) {
    try { sessionStorage.setItem("wc:" + key, JSON.stringify({ t: Date.now(), v })); } catch {}
  }
  async function get(key, path, pick) {
    const hit = cached(key);
    if (hit) return hit;
    const data = await fetchJSON(path);
    const v = pick ? pick(data) : data;
    store(key, v);
    return v;
  }

  /* ---- parsers / helpers ---------------------------------------------- */

  // scorers come as a Postgres array literal: {"Name 27'","Other 90'+2'"} or "null"
  function parseScorers(raw) {
    if (!raw || raw === "null" || raw === "{}") return [];
    let s = String(raw).trim().replace(/^\{/, "").replace(/\}$/, "");
    if (!s) return [];
    // split on the comma that separates quoted entries
    const parts = s.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) || [];
    return parts.map((p) => {
      const txt = p.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\'/g, "'");
      const m = txt.match(/^(.*?)(\d+'(?:\+\d+'?)?(?:\s*\(p\)| \(og\))?)\s*$/);
      if (m) return { name: m[1].trim(), min: m[2].trim() };
      return { name: txt, min: "" };
    });
  }

  // "MM/DD/YYYY HH:mm" -> Date
  function parseDate(s) {
    if (!s) return null;
    const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!m) return new Date(s);
    return new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]);
  }

  const STAGE_LABELS = {
    group: "Group", r32: "Round of 32", r16: "Round of 16",
    qf: "Quarter-final", sf: "Semi-final", third: "3rd place", final: "Final",
  };
  function stageShort(g) {
    const code = String(g.type || "").toLowerCase();
    if (code === "group") return "Group " + (g.group || "");
    return { r32: "R32", r16: "R16", qf: "QF", sf: "SF", third: "3RD", final: "FINAL" }[code] || (g.group || "");
  }
  function stageBadge(g) {
    const code = String(g.type || "").toLowerCase();
    return code === "final" ? "FINAL" : stageShort(g);
  }

  const isFinished = (g) => String(g.finished).toUpperCase() === "TRUE";
  const isLive = (g) => {
    const te = String(g.time_elapsed || "").toLowerCase();
    return !isFinished(g) && te !== "notstarted" && te !== "" && te !== "null";
  };

  /* ---- aggregate loader: everything in parallel, then index it -------- */
  async function loadAll() {
    const [groups, teams, games, stadiums, health, palpites] = await Promise.all([
      get("groups", "/get/groups", (d) => d.groups || []),
      get("teams", "/get/teams", (d) => d.teams || []),
      get("games", "/get/games", (d) => d.games || []),
      get("stadiums", "/get/stadiums", (d) => d.stadiums || []).catch(() => []),
      fetchJSON("/health", { retries: 2 }).catch(() => null),
      // local prediction-pool data (static): friends' bolão predictions
      fetch("data/palpites.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    const teamById = {};
    teams.forEach((t) => (teamById[String(t.id)] = t));
    const stadiumById = {};
    (stadiums || []).forEach((s) => (stadiumById[String(s.id)] = s));

    return { groups, teams, games, stadiums: stadiums || [], health, teamById, stadiumById, palpites };
  }

  return { loadAll, parseScorers, parseDate, stageShort, stageBadge, STAGE_LABELS, isFinished, isLive };
})();
