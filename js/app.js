/* =========================================================================
   app.js — render the three sections and wire interactions.
   ========================================================================= */

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let STATE = null;
  let NOW = new Date();

  /* date helpers — games are shown in Brasília (BR) & Portugal (PT) time -- */
  const TZ_BR = "America/Sao_Paulo", TZ_PT = "Europe/Lisbon";
  const fmtBR = (d) => (d ? new Intl.DateTimeFormat("pt-BR", { timeZone: TZ_BR, hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "");
  const fmtPT = (d) => (d ? new Intl.DateTimeFormat("pt-PT", { timeZone: TZ_PT, hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "");
  const fmtDayBR = (d) => new Intl.DateTimeFormat("en-US", { timeZone: TZ_BR, weekday: "short", day: "numeric", month: "short" }).format(d);
  const dayKeyBR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ_BR, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const sameDay = (a, b) => a && b && dayKeyBR(a) === dayKeyBR(b);

  const teamName = (g, side) => g[`${side}_team_name_en`] || g[`${side}_team_label`] || "";
  const flagOf = (id) => STATE.teamById[String(id)]?.flag || "";

  /* ===================================================================
     BOOT
     =================================================================== */
  async function boot() {
    skeletons();
    document.documentElement.style.setProperty("--appbar-h", $(".appbar").offsetHeight + "px");
    try {
      STATE = await WC.loadAll();
      if (STATE.health?.timestamp) NOW = new Date(STATE.health.timestamp);
      renderStatus();
      renderTicker();
      renderStandings();
      renderGames();
      renderTeams();
      renderBoloes();
      if (location.hash) routeFromHash();
    } catch (err) {
      const msg = `<div class="error"><b>Couldn't reach the World Cup feed</b>
        The API is a little slow today — give it another go.
        <br><button class="retry">Try again</button></div>`;
      ["#groups", "#fixtures", "#teams"].forEach((s) => ($(s).innerHTML = msg));
      $$(".retry").forEach((b) => b.addEventListener("click", boot));
      console.error(err);
    }
  }

  function skeletons() {
    $("#groups").innerHTML = Array(4).fill('<div class="skeleton skel-card"></div>').join("");
    $("#fixtures").innerHTML = Array(3).fill('<div class="skeleton skel-card"></div>').join("");
    $("#teams").innerHTML = Array(8).fill('<div class="skeleton skel-card" style="height:120px"></div>').join("");
  }

  /* ===================================================================
     STATUS (header pills)
     =================================================================== */
  function currentPhase() {
    const g = STATE.games;
    const groupGames = g.filter((x) => String(x.type).toLowerCase() === "group");
    const nextGroup = groupGames.filter((x) => !WC.isFinished(x)).sort((a, b) => (+a.matchday) - (+b.matchday))[0];
    if (nextGroup) return `Groups · MD ${nextGroup.matchday}`;
    const order = ["r32", "r16", "qf", "sf", "third", "final"];
    for (const code of order) {
      const left = g.filter((x) => String(x.type).toLowerCase() === code && !WC.isFinished(x));
      if (left.length) return WC.STAGE_LABELS[code];
    }
    return "Tournament complete";
  }

  function renderStatus() {
    const played = STATE.games.filter(WC.isFinished).length;
    const live = STATE.games.filter(WC.isLive).length;
    $("#statusPhase").textContent = currentPhase();
    $("#statusPlayed").textContent = `${played}/${STATE.games.length} played`;
    if (live) {
      const pill = document.createElement("span");
      pill.className = "status__pill";
      pill.style.color = "var(--magenta)";
      pill.style.borderColor = "rgba(255,45,110,.4)";
      pill.innerHTML = `<span class="dot-live" style="display:inline-block;margin-right:.3rem"></span>${live} live`;
      $("#statusPlayed").after(pill);
    }
  }

  /* ===================================================================
     TICKER (signature) — recent results + anything live
     =================================================================== */
  function renderTicker() {
    const live = STATE.games.filter(WC.isLive);
    const recent = STATE.games
      .filter(WC.isFinished)
      .sort((a, b) => (WC.gameInstant(b) - WC.gameInstant(a)))
      .slice(0, 14);
    const items = [...live, ...recent];
    if (!items.length) {
      $("#ticker").style.display = "none";
      return;
    }
    const cell = (g) => {
      const liveTag = WC.isLive(g) ? `<span class="tick__live"></span>` : "";
      const cls = WC.isLive(g) ? "tick tick--live" : "tick";
      return `<span class="${cls}">${liveTag}
        <img src="${flagOf(g.home_team_id)}" alt="" loading="lazy">
        <b>${esc((STATE.teamById[g.home_team_id]?.fifa_code) || teamName(g, "home"))}</b>
        <span class="tick__sc">${esc(g.home_score)}–${esc(g.away_score)}</span>
        <b>${esc((STATE.teamById[g.away_team_id]?.fifa_code) || teamName(g, "away"))}</b>
        <img src="${flagOf(g.away_team_id)}" alt="" loading="lazy"></span>`;
    };
    const html = items.map(cell).join("");
    // duplicate the track so the loop is seamless
    $("#tickerTrack").innerHTML = html + html;
    $("#ticker").style.setProperty("--ticker-dur", Math.max(28, items.length * 4.5) + "s");
  }

  /* ===================================================================
     STANDINGS
     =================================================================== */
  function sortStandings(teams) {
    return [...teams].sort(
      (a, b) => (+b.pts - +a.pts) || (+b.gd - +a.gd) || (+b.gf - +a.gf)
    );
  }
  function renderStandings() {
    const html = [...STATE.groups]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((grp) => {
        const rows = sortStandings(grp.teams)
          .map((t, i) => {
            const team = STATE.teamById[String(t.team_id)] || {};
            const rowCls = i < 2 ? " row--q" : i === 2 ? " row--3" : "";
            return `<div class="stand__row${rowCls}" role="row">
              <span role="cell"><span class="pos">${i + 1}</span></span>
              <span class="col-team" role="cell"><span class="team-cell">
                <img src="${team.flag || ""}" alt="" loading="lazy">
                <span class="nm">${esc(team.name_en || "TBD")}</span></span></span>
              <span role="cell">${t.mp}</span>
              <span class="col-w" role="cell">${t.w}</span>
              <span class="col-d" role="cell">${t.d}</span>
              <span class="col-l" role="cell">${t.l}</span>
              <span class="col-gf" role="cell">${t.gf}</span>
              <span class="col-ga" role="cell">${t.ga}</span>
              <span role="cell">${(+t.gd) > 0 ? "+" : ""}${t.gd}</span>
              <span class="col-pts" role="cell">${t.pts}</span>
            </div>`;
          }).join("");
        return `<div class="group">
          <div class="group__head">
            <span class="group__badge">${esc(grp.name)}</span>
            <span class="group__label">Group ${esc(grp.name)}</span>
          </div>
          <div class="stand" role="table" aria-label="Group ${esc(grp.name)} standings">
            <div class="stand__row stand__row--head" role="row">
              <span role="columnheader"></span>
              <span class="col-team" role="columnheader">Team</span>
              <span role="columnheader">MP</span>
              <span class="col-w" role="columnheader">W</span>
              <span class="col-d" role="columnheader">D</span>
              <span class="col-l" role="columnheader">L</span>
              <span class="col-gf" role="columnheader">GF</span>
              <span class="col-ga" role="columnheader">GA</span>
              <span role="columnheader">GD</span>
              <span class="col-pts" role="columnheader">Pts</span>
            </div>
            ${rows}
          </div>
        </div>`;
      }).join("");
    $("#groups").innerHTML = html;
  }

  /* ===================================================================
     GAMES
     =================================================================== */
  const STAGE_FILTERS = [
    { key: "all", label: "All", match: () => true },
    { key: "today", label: "Today", match: (g) => sameDay(WC.gameInstant(g), NOW) },
    { key: "group", label: "Groups", match: (g) => String(g.type).toLowerCase() === "group" },
    { key: "r32", label: "R32", match: (g) => String(g.type).toLowerCase() === "r32" },
    { key: "r16", label: "R16", match: (g) => String(g.type).toLowerCase() === "r16" },
    { key: "qf", label: "Quarters", match: (g) => String(g.type).toLowerCase() === "qf" },
    { key: "sf", label: "Semis", match: (g) => String(g.type).toLowerCase() === "sf" },
    { key: "final", label: "Final", match: (g) => ["final", "third"].includes(String(g.type).toLowerCase()) },
  ];
  let gamesFilter = "all";

  function venueText(g) {
    const s = STATE.stadiumById[String(g.stadium_id)];
    if (!s) return "";
    return [s.fifa_name || s.name_en, s.city_en].filter(Boolean).join(" · ");
  }

  function scorersBlock(g) {
    const home = WC.parseScorers(g.home_scorers);
    const away = WC.parseScorers(g.away_scorers);
    if (!home.length && !away.length) return "";
    const col = (list) => `<div class="sc-col">${list.map((s) =>
      `<span class="gl"><span>${esc(s.name)}</span><span class="min">${esc(s.min)}</span></span>`).join("")}</div>`;
    return `<div class="match__scorers">${col(home)}${col(away)}</div>`;
  }

  function matchCard(g) {
    const d = WC.gameInstant(g);
    const finished = WC.isFinished(g);
    const live = WC.isLive(g);
    const hs = +g.home_score, as = +g.away_score;
    const homeName = teamName(g, "home"), awayName = teamName(g, "away");
    const homeTbd = !g.home_team_name_en, awayTbd = !g.away_team_name_en;

    let homeCls = "side", awayCls = "side";
    if (finished) {
      if (hs > as) { homeCls += " side--winner"; awayCls += " side--loser"; }
      else if (as > hs) { awayCls += " side--winner"; homeCls += " side--loser"; }
    }

    let kick;
    if (live) kick = `<span class="kick kick--live"><span class="dot-live"></span>${esc(g.time_elapsed)}'</span>`;
    else if (finished) kick = `<span class="kick">FT</span>`;
    else kick = `<span class="kick kick--zones"><span class="z"><i>BR</i>${fmtBR(d)}</span><span class="z"><i>PT</i>${fmtPT(d)}</span></span>`;

    const score = (val, tbd) => (finished || live)
      ? `<span class="side__score">${esc(val)}</span>`
      : `<span class="side__score" style="color:var(--muted);font-size:.95rem">–</span>`;

    const sideRow = (cls, name, tbd, id, val) => `<div class="${cls}">
      <img src="${tbd ? "" : flagOf(id)}" alt="" loading="lazy">
      <span class="side__name${tbd ? " tbd" : ""}">${esc(name || "TBD")}</span>
      ${score(val, tbd)}</div>`;

    const venue = venueText(g);
    const scorers = finished ? scorersBlock(g) : "";
    const canOpen = scorers ? ' data-toggle="1"' : "";

    return `<div class="match${live ? " match--live" : ""}"${canOpen}>
      <div class="match__top">
        <span class="stage-badge" data-stage="${esc(WC.stageBadge(g))}">${esc(WC.stageBadge(g))}</span>
        ${kick}
      </div>
      ${sideRow(homeCls, homeName, homeTbd, g.home_team_id, g.home_score)}
      ${sideRow(awayCls, awayName, awayTbd, g.away_team_id, g.away_score)}
      ${venue ? `<div class="match__venue"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>${esc(venue)}</div>` : ""}
      ${scorers}
    </div>`;
  }

  function renderGames() {
    $("#stageChips").innerHTML = STAGE_FILTERS.map((f) =>
      `<button class="chip${f.key === gamesFilter ? " is-active" : ""}" data-filter="${f.key}">${f.label}</button>`).join("");

    const filterFn = STAGE_FILTERS.find((f) => f.key === gamesFilter).match;
    const list = STATE.games
      .filter(filterFn)
      .map((g) => ({ g, d: WC.gameInstant(g) }))
      .sort((a, b) => a.d - b.d);

    if (!list.length) {
      $("#fixtures").innerHTML = `<div class="empty">No matches in this view.</div>`;
      return;
    }

    // group by calendar day
    const days = [];
    let cur = null;
    list.forEach(({ g, d }) => {
      const k = dayKeyBR(d);
      if (!cur || cur.k !== k) { cur = { k, d, games: [] }; days.push(cur); }
      cur.games.push(g);
    });

    $("#fixtures").innerHTML = days.map((day) => {
      const today = sameDay(day.d, NOW);
      return `<div class="daygroup" ${today ? 'data-today="1"' : ""}>
        <div class="daygroup__date${today ? " is-today" : ""}">${fmtDayBR(day.d)}${today ? '<span class="today-tag">TODAY</span>' : ""}</div>
        ${day.games.map(matchCard).join("")}
      </div>`;
    }).join("");
  }

  /* ===================================================================
     TEAMS
     =================================================================== */
  let groupFilter = "all";
  function renderTeams() {
    const groupNames = [...new Set(STATE.teams.map((t) => t.groups))].sort();
    $("#groupChips").innerHTML =
      `<button class="chip${groupFilter === "all" ? " is-active" : ""}" data-group="all">All 48</button>` +
      groupNames.map((g) => `<button class="chip${groupFilter === g ? " is-active" : ""}" data-group="${esc(g)}">Group ${esc(g)}</button>`).join("");

    const list = STATE.teams
      .filter((t) => groupFilter === "all" || t.groups === groupFilter)
      .sort((a, b) => (a.groups || "").localeCompare(b.groups || "") || a.name_en.localeCompare(b.name_en));

    $("#teams").innerHTML = list.map((t) => `<button class="teamcard" data-team="${esc(t.id)}">
      <span class="teamcard__grp">${esc(t.groups || "")}</span>
      <img src="${t.flag || ""}" alt="" loading="lazy">
      <div class="teamcard__name">${esc(t.name_en)}</div>
      <div class="teamcard__code">${esc(t.fifa_code || "")}</div>
    </button>`).join("");
  }

  /* ===================================================================
     BOLÃO  (prediction pool)
     =================================================================== */
  function teamByName(name) {
    if (!STATE._byName) { STATE._byName = {}; STATE.teams.forEach((t) => (STATE._byName[t.name_en] = t)); }
    return STATE._byName[name] || {};
  }
  const codeOf = (name) => teamByName(name).fifa_code || name;
  const flagByName = (name) => teamByName(name).flag || "";
  let detailTab = "p1";

  function showBoloesList() {
    $("#boloesList").hidden = false;
    $("#boloesDetail").hidden = true;
    STATE && (STATE._curPart = null);
    if (location.hash.startsWith("#boloes/")) history.replaceState(null, "", "#boloes");
  }

  function renderBoloes() {
    const board = $("#board");
    if (!STATE.palpites || !STATE.palpites.participants) {
      board.innerHTML = `<div class="empty">Couldn't load the pool predictions (data/palpites.json).</div>`;
      return;
    }
    STATE.scored = Scoring.leaderboard(STATE.palpites.participants, STATE.games);
    const played = STATE.games.filter(WC.isFinished).length;
    $("#boloesNote").innerHTML =
      `${STATE.palpites.participants.length} players · scored on ${played} finished games · tap a name for details`;

    board.innerHTML = STATE.scored.map((p, i) => `
      <button class="brow${i < 3 ? " brow--m" + (i + 1) : ""}" data-part="${esc(p.id)}">
        <span class="brow__pos">${i + 1}</span>
        <span class="brow__name">${esc(p.name)}</span>
        <span class="brow__meta">
          <span class="bmeta"><b>${p.exact}</b> exact</span>
          <span class="bmeta"><b>${p.correct}</b> hits</span>
        </span>
        <span class="brow__pts">${p.total}<small>pts</small></span>
      </button>`).join("");
  }

  function openParticipant(id) {
    const p = (STATE.scored || []).find((x) => x.id === id);
    if (!p) return;
    STATE._curPart = p;
    detailTab = "p1";
    $("#boloesList").hidden = true;
    $("#boloesDetail").hidden = false;
    renderDetail(p);
    if (location.hash !== "#boloes/" + p.id) history.replaceState(null, "", "#boloes/" + p.id);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderDetail(p) {
    const head = `
      <button class="backbtn" data-back>‹ Bolão Geral</button>
      <div class="dhead">
        <h2 class="dhead__name">${esc(p.name)}</h2>
        <div class="dhead__total">${p.total}<small>pts</small></div>
      </div>
      <div class="dstats">
        <div class="statbox"><b>${p.p1}</b><span>Phase 1</span></div>
        <div class="statbox"><b>${p.p2}</b><span>Phase 2</span></div>
        <div class="statbox"><b>${p.exact}</b><span>Exact</span></div>
        <div class="statbox"><b>${p.correct}</b><span>Hits</span></div>
      </div>
      <div class="chips dtabs">
        <button class="chip${detailTab === "p1" ? " is-active" : ""}" data-dtab="p1">Matches (Phase 1)</button>
        <button class="chip${detailTab === "p2" ? " is-active" : ""}" data-dtab="p2">Knockout (Phase 2)</button>
      </div>`;
    $("#boloesDetail").innerHTML = head + `<div id="dlist">${detailTab === "p1" ? detailP1(p) : detailP2(p)}</div>`;
  }

  function detailP1(p) {
    return p.perMatch.map((m) => {
      const cls = m.pending ? "pend" : "t" + m.points;
      const pill = m.pending ? `<span class="ppill pend">–</span>` : `<span class="ppill t${m.points}">+${m.points}</span>`;
      const sub = m.pending
        ? `<span class="muted">not played yet</span>`
        : `actual <b>${m.actual.h}-${m.actual.a}</b>`;
      return `<div class="bmatch ${cls}">
        <div class="bmatch__main">
          <img src="${flagByName(m.home)}" alt="" loading="lazy">
          <span class="bm__code">${esc(codeOf(m.home))}</span>
          <span class="bm__pred">${m.ph}<i>-</i>${m.pa}</span>
          <span class="bm__code">${esc(codeOf(m.away))}</span>
          <img src="${flagByName(m.away)}" alt="" loading="lazy">
          ${pill}
        </div>
        <div class="bmatch__sub"><span class="grp">Group ${esc(m.group)}</span> · ${sub}</div>
      </div>`;
    }).join("");
  }

  function detailP2(p) {
    const L = Scoring.STAGE_LABEL;
    const rows = p.perTeam.map((t) => {
      const earned = t.points > 0;
      const pill = earned ? `<span class="ppill t6">+${t.points}</span>` : `<span class="ppill pend">–</span>`;
      const actual = t.actualStage > 0 ? L[t.actualStage] : "pending";
      return `<div class="bteam ${earned ? "ok" : "pend"}">
        <img src="${flagByName(t.team)}" alt="" loading="lazy">
        <span class="bteam__name">${esc(t.team)}</span>
        <span class="bteam__stage">pick: <b>${L[t.predStage]}</b> · now: ${actual}</span>
        ${pill}
      </div>`;
    }).join("");
    return `<p class="panel__note" style="margin:.2rem 0 .8rem">Cumulative points per stage a picked team actually reaches. Mostly pending until the knockouts begin.</p>${rows}`;
  }

  /* ===================================================================
     TEAM SHEET
     =================================================================== */
  function openTeam(id) {
    const t = STATE.teamById[String(id)];
    if (!t) return;
    const grp = STATE.groups.find((g) => g.name === t.groups);
    let standing = null, pos = null;
    if (grp) {
      const sorted = sortStandings(grp.teams);
      pos = sorted.findIndex((x) => String(x.team_id) === String(t.id));
      standing = sorted[pos];
    }
    const fixtures = STATE.games
      .filter((g) => String(g.home_team_id) === String(t.id) || String(g.away_team_id) === String(t.id))
      .map((g) => ({ g, d: WC.gameInstant(g) }))
      .sort((a, b) => a.d - b.d);

    const stats = standing ? `<div class="sheet__stats">
      <div class="statbox"><b>${pos + 1}${["st","nd","rd"][pos] ? ["st","nd","rd"][pos] : "th"}</b><span>Group</span></div>
      <div class="statbox"><b>${standing.pts}</b><span>Points</span></div>
      <div class="statbox"><b>${standing.w}-${standing.d}-${standing.l}</b><span>W-D-L</span></div>
      <div class="statbox"><b>${(+standing.gd) > 0 ? "+" : ""}${standing.gd}</b><span>GD</span></div>
    </div>` : "";

    const fxRows = fixtures.map(({ g, d }) => {
      const home = String(g.home_team_id) === String(t.id);
      const oppId = home ? g.away_team_id : g.home_team_id;
      const oppName = home ? (teamName(g, "away") || "TBD") : (teamName(g, "home") || "TBD");
      const fin = WC.isFinished(g);
      const mine = home ? g.home_score : g.away_score;
      const theirs = home ? g.away_score : g.home_score;
      let res = "", resCol = "var(--muted)";
      if (fin) {
        if (+mine > +theirs) { res = "W"; resCol = "var(--q)"; }
        else if (+mine < +theirs) { res = "L"; resCol = "var(--can)"; }
        else { res = "D"; resCol = "var(--gold)"; }
      }
      return `<div class="match" style="margin-bottom:.5rem;padding:.6rem .75rem">
        <div class="match__top"><span class="stage-badge">${esc(WC.stageBadge(g))}</span>
          <span class="kick">${fin ? "FT" : (d ? fmtDayBR(d) + " · BR " + fmtBR(d) + " · PT " + fmtPT(d) : "")}</span></div>
        <div class="side" style="padding:.1rem 0">
          <img src="${flagOf(oppId)}" alt="">
          <span class="side__name" style="font-size:.88rem">${home ? "vs" : "@"} ${esc(oppName)}</span>
          ${fin ? `<span style="font-family:var(--font-num);font-weight:700;color:${resCol}">${res} ${esc(mine)}-${esc(theirs)}</span>` : ""}
        </div></div>`;
    }).join("");

    $("#sheetBody").innerHTML = `
      <div class="sheet__hero">
        <img src="${t.flag || ""}" alt="">
        <div><h3 id="sheetTitle">${esc(t.name_en)}</h3>
        <div class="sub">${esc(t.fifa_code || "")} · Group ${esc(t.groups || "")}</div></div>
      </div>
      ${stats}
      <div class="sheet__sub">Fixtures</div>
      ${fxRows || '<div class="empty">No fixtures yet.</div>'}`;
    const sheet = $("#sheet");
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeSheet() { $("#sheet").hidden = true; document.body.style.overflow = ""; }

  /* ===================================================================
     EVENTS
     =================================================================== */
  // tab switching (deep-linkable via #standings / #games / #teams)
  function activateTab(go, { scroll = true } = {}) {
    if (!["standings", "games", "teams", "boloes"].includes(go)) go = "standings";
    if (go === "boloes") showBoloesList();
    $$(".tabbar__btn").forEach((b) => {
      const on = b.dataset.go === go;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== go));
    document.body.dataset.tab = go;
    if (location.hash.slice(1) !== go) history.replaceState(null, "", "#" + go);
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
    if (go === "games") {
      requestAnimationFrame(() => {
        const today = $('.daygroup[data-today="1"]');
        if (today) today.scrollIntoView({ block: "start", behavior: "auto" });
      });
    }
  }
  $$(".tabbar__btn").forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.go)));

  function routeFromHash({ scroll = false } = {}) {
    const [tab, sub] = location.hash.slice(1).split("/");
    activateTab(tab, { scroll });
    if (tab === "boloes" && sub) openParticipant(decodeURIComponent(sub));
  }
  window.addEventListener("hashchange", () => routeFromHash());

  // delegated clicks: filters, team cards, match expand, sheet close
  document.addEventListener("click", (e) => {
    const fchip = e.target.closest("[data-filter]");
    if (fchip) { gamesFilter = fchip.dataset.filter; renderGames(); return; }
    const gchip = e.target.closest("[data-group]");
    if (gchip) { groupFilter = gchip.dataset.group; renderTeams(); return; }
    const card = e.target.closest("[data-team]");
    if (card) { openTeam(card.dataset.team); return; }
    const part = e.target.closest("[data-part]");
    if (part) { openParticipant(part.dataset.part); return; }
    if (e.target.closest("[data-back]")) { showBoloesList(); return; }
    const dtab = e.target.closest("[data-dtab]");
    if (dtab) {
      detailTab = dtab.dataset.dtab;
      if (STATE._curPart) renderDetail(STATE._curPart);
      return;
    }
    if (e.target.closest("[data-close]")) { closeSheet(); return; }
    const m = e.target.closest('.match[data-toggle]');
    if (m) m.classList.toggle("is-open");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  boot();
})();
