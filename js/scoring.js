/* =========================================================================
   scoring.js — pure scoring for the Bolão. No DOM, no fetch.
   Predictions are fixed (data/palpites.json); results are live (the API);
   points are a pure function of the two, recomputed each load.
   ========================================================================= */

const Scoring = (() => {
  // Phase-1 tiers (printed in the spreadsheets)
  const P1 = { exact: 6, winnerScore: 3, loserScore: 2, outcome: 1 };
  // Phase-2 cumulative stage points (user-confirmed)
  const STAGE_PTS = { 1: 2, 2: 3, 3: 5, 4: 10, 5: 18, 6: 20 };
  const STAGE_LABEL = { 0: "Group", 1: "R32", 2: "R16", 3: "QF", 4: "SF", 5: "Final", 6: "Champion" };
  const TYPE_STAGE = { r32: 1, r16: 2, qf: 3, sf: 4, final: 5 }; // 'group'/'third' excluded

  const isFinished = (g) => String(g.finished).toUpperCase() === "TRUE";

  /* ---- build the join context from live API data, once per load -------- */
  function buildContext(games) {
    const byPair = {};                 // "Home||Away" -> game (group stage)
    for (const g of games) {
      if (String(g.type).toLowerCase() !== "group") continue;
      const h = g.home_team_name_en, a = g.away_team_name_en;
      if (h && a) byPair[h + "||" + a] = g;
    }
    // furthest stage each team actually reached (from resolved knockout games)
    const reached = {};
    const bump = (name, s) => { if (name) reached[name] = Math.max(reached[name] || 0, s); };
    for (const g of games) {
      const s = TYPE_STAGE[String(g.type).toLowerCase()];
      if (!s) continue;
      bump(g.home_team_name_en, s);
      bump(g.away_team_name_en, s);
      if (String(g.type).toLowerCase() === "final" && isFinished(g)) {
        const hs = +g.home_score, as = +g.away_score;
        if (hs !== as) bump(hs > as ? g.home_team_name_en : g.away_team_name_en, 6);
      }
    }
    return { byPair, reached };
  }

  /* ---- one phase-1 match: predicted (ph,pa) vs the real score ---------- */
  function scoreMatch(pred, ctx) {
    let g = ctx.byPair[pred.home + "||" + pred.away];
    let flipped = false;
    if (!g) { g = ctx.byPair[pred.away + "||" + pred.home]; flipped = true; }
    if (!g || !isFinished(g)) return { points: null, actual: null, pending: true };

    // actual goals oriented to the prediction's home/away
    const gh = +g.home_score, ga = +g.away_score;
    const aH = flipped ? ga : gh;
    const aA = flipped ? gh : ga;
    const ph = pred.ph, pa = pred.pa;

    let points;
    if (ph === aH && pa === aA) points = P1.exact;
    else if (Math.sign(ph - pa) !== Math.sign(aH - aA)) points = 0; // wrong outcome
    else if (aH === aA) points = P1.winnerScore;                    // correct draw, wrong score
    else {
      const predWinG = ph > pa ? ph : pa, predLosG = ph > pa ? pa : ph;
      const actWinG = aH > aA ? aH : aA, actLosG = aH > aA ? aA : aH;
      if (predWinG === actWinG) points = P1.winnerScore;
      else if (predLosG === actLosG) points = P1.loserScore;
      else points = P1.outcome;
    }
    return { points, actual: { h: aH, a: aA }, pending: false };
  }

  /* ---- one phase-2 team: cumulative points up to min(pred, actual) ----- */
  function scoreTeam(predStage, actualStage) {
    let pts = 0;
    for (let s = 1; s <= Math.min(predStage, actualStage); s++) pts += STAGE_PTS[s];
    return pts;
  }

  /* ---- a full participant ---------------------------------------------- */
  function scoreParticipant(p, ctx) {
    let p1 = 0, exact = 0, correct = 0;
    const perMatch = p.phase1.map((pred) => {
      const r = scoreMatch(pred, ctx);
      if (r.points != null) { p1 += r.points; if (r.points === P1.exact) exact++; if (r.points >= 1) correct++; }
      return { ...pred, ...r };
    });
    let p2 = 0;
    const perTeam = Object.entries(p.phase2).map(([team, predStage]) => {
      const actualStage = ctx.reached[team] || 0;
      const points = scoreTeam(predStage, actualStage);
      p2 += points;
      return { team, predStage, actualStage, points };
    }).sort((a, b) => b.predStage - a.predStage || b.points - a.points || a.team.localeCompare(b.team));

    return { id: p.id, name: p.name, total: p1 + p2, p1, p2, exact, correct, perMatch, perTeam };
  }

  function leaderboard(participants, games) {
    const ctx = buildContext(games);
    return participants
      .map((p) => scoreParticipant(p, ctx))
      .sort((a, b) => b.total - a.total || b.exact - a.exact || b.p1 - a.p1 || a.name.localeCompare(b.name));
  }

  return { buildContext, scoreParticipant, leaderboard, STAGE_LABEL, STAGE_PTS, P1 };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Scoring;
