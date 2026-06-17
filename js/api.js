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

  // "MM/DD/YYYY HH:mm" -> Date in the browser's local zone (legacy helper)
  function parseDate(s) {
    if (!s) return null;
    const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!m) return new Date(s);
    return new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]);
  }

  // local_date is the kickoff in the STADIUM's local time. Map each venue to
  // its IANA zone so we can recover the true UTC instant (DST handled by Intl).
  const STADIUM_TZ = {
    1: "America/Mexico_City", 2: "America/Mexico_City", 3: "America/Monterrey", // Mexico, UTC-6
    4: "America/Chicago", 5: "America/Chicago", 6: "America/Chicago",            // US Central, UTC-5 (DST)
    7: "America/New_York", 8: "America/New_York", 9: "America/New_York",
    10: "America/New_York", 11: "America/New_York", 12: "America/Toronto",       // Eastern, UTC-4 (DST)
    13: "America/Vancouver", 14: "America/Los_Angeles",
    15: "America/Los_Angeles", 16: "America/Los_Angeles",                        // Western, UTC-7 (DST)
  };

  // offset (minutes) of a zone at a given instant
  function tzOffsetMin(date, tz) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return (asUTC - date.getTime()) / 60000;
  }

  // interpret a wall-clock time as being in `tz`, return the matching UTC Date
  function wallToUTC(y, mo, d, h, mi, tz) {
    const ts = Date.UTC(y, mo - 1, d, h, mi);
    return new Date(ts - tzOffsetMin(new Date(ts), tz) * 60000);
  }

  // true UTC instant of a game's kickoff (from venue-local local_date)
  function gameInstant(g) {
    const m = String(g.local_date || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!m) return null;
    const tz = STADIUM_TZ[String(g.stadium_id)] || "America/New_York";
    return wallToUTC(+m[3], +m[1], +m[2], +m[4], +m[5], tz);
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

  // fetch a SINGLE game fresh (light) by its Mongo _id — for live polling.
  // The single-game endpoint omits team names; the caller re-attaches them.
  async function getGameById(mongoId) {
    try {
      const d = await fetchJSON("/get/game/" + mongoId, { retries: 2 });
      return d.game || d || null;
    } catch { return null; }
  }

  // fetch groups (standings) fresh, bypassing the cache — used when a game ends
  async function refreshGroups() {
    try {
      const d = await fetchJSON("/get/groups", { retries: 2 });
      const groups = d.groups || [];
      store("groups", groups);
      return groups;
    } catch { return null; }
  }

  return { loadAll, parseScorers, parseDate, gameInstant, stageShort, stageBadge, STAGE_LABELS, isFinished, isLive, getGameById, refreshGroups };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WC;
