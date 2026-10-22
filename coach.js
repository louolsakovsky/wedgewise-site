/* WedgeLab Coaching Dashboard. Coaches sign in with an emailed link, create their team, add players' emails,
   share the team code, and study their players' results: Overview (the team inside 150 yards from real rounds:
   who hits it closest, who is trending up or down, team trend by month, where the team loses shots; Lou, Oct 19),
   Players (sortable roster, then each player's proximity, rounds and wedge-number matrix) and Team (billing, code, invites).
   Deliberately no activity tracking (no last active, shots this week, "locked in" counts), no consistency / ± spread and no gapping view: Lou, Oct 15.
   Data rules (who can see what) live in supabase/teams.sql. */
(function () {
  const URL = "https://hayymoyocfbjoaifgrnf.supabase.co";
  const KEY = "sb_publishable_VitLrXAoU4154mNLQxWf1g_GxGU8ON0";
  const SUPPORT = "support@wedgelab.app";
  /* Stripe Payment Link for "WedgeLab Teams, $499 a year". Empty = card payment not switched on yet (invoice only).
     The team's id rides along as client_reference_id, so the stripe-webhook function knows which team to switch on. */
  const PAY_LINK = "https://buy.stripe.com/test_14A28s75Z7il09x2UF7ok00";
  const justPaid = /[?&]paid=1/.test(location.search);
  /* DEMO (Lou, Oct 22): coach.html?demo=1 shows a made-up team from coach-demo.js. Nothing is read from or saved to the database. */
  const DEMO = /[?&]demo=1/.test(location.search);
  const demoNote = "Demo team: nothing here is saved.";
  let paidChecks = 0;
  const sb = window.supabase.createClient(URL, KEY, { auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true } });
  const app = document.getElementById("app");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* What a coach types is kept: across page refreshes, and if the iPhone reloads the page after they switch apps. */
  const DRAFT = "ww.coach.draft";
  const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT) || "{}"); } catch { return {}; } };
  const saveDraft = d => { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch {} };
  const clearDraft = (...ids) => { const d = readDraft(); ids.forEach(i => delete d[i]); saveDraft(d); };
  app.addEventListener("input", e => { const t = e.target; if (t && t.id && t.tagName === "INPUT" && t.dataset.draft !== "no") { const d = readDraft(); d[t.id] = t.value; saveDraft(d); } });
  const typing = () => [...app.querySelectorAll("input:not([data-draft=no])")].some(i => i.value || document.activeElement === i);
  const html = h => {
    const d = readDraft();
    app.innerHTML = h;
    app.querySelectorAll("input[id]").forEach(i => { if (!i.value && d[i.id] && i.dataset.draft !== "no") i.value = d[i.id]; });
  };
  const $ = id => document.getElementById(id);

  /* Small line icons, same set as the app. */
  const ICONS = {
    team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2A5 5 0 0 1 21 19"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    chevron: '<polyline points="9 5 16 12 9 19"/>', back: '<polyline points="15 5 8 12 15 19"/>',
    up: '<path d="M12 19V6M6 11l6-6 6 6"/>', down: '<path d="M12 5v13M6 13l6 6 6-6"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><polyline points="20 4 20 9 15 9"/>',
    sort: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  };
  const ic = (n, s = 18) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  /* ---- the same math as the app: normalize to 75°F at sea level, then the average (Lou, Oct 22) ---- */
  /* Effect grows with carry: 0.8% per 10°F and 1.3% per 1,000 ft for a 100-yard shot, scaled by carry / 100. */
  const factor = (t, e, std) => { const L = Math.max(0, std) / 100; return (1 + 0.008 * L * (t - 75) / 10) * (1 + 0.013 * L * e / 1000); };
  const toStd = (carry, t, e) => { let s = carry; for (let i = 0; i < 30; i++) { const n = carry / factor(t, e, s); if (Math.abs(n - s) < 1e-9) return n; s = n; } return s; };
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const FRACTION = [{ k: "half", label: "½" }, { k: "tq", label: "¾" }, { k: "full", label: "Full" }];
  const BAG = ["LW", "SW", "GW", "PW", "9I"];
  const DAY = 864e5;
  function analyze(p) {
    const st = p.state || {};
    const swings = st.system === "custom" && st.custom && st.custom.efforts ? st.custom.efforts : FRACTION;
    const clubs = (st.clubs || []).slice().sort((a, b) => BAG.indexOf(a.name) - BAG.indexOf(b.name));
    const shots = (st.shots || []).filter(x => !x.wet && x.carry > 0 && x.tempF != null && x.elevFt != null && swings.some(w => w.k === x.swing));
    const cells = {};
    shots.forEach(x => { const k = x.clubId + "|" + x.swing; (cells[k] = cells[k] || []).push({ shot: x, norm: toStd(x.carry, x.tempF, x.elevFt), t: Date.parse(x.date) || 0 }); });
    const cut = Date.now() - 28 * DAY;
    const cell = (clubId, k) => {
      const a = cells[clubId + "|" + k]; if (!a) return null;
      const vals = a.map(x => x.norm), recent = a.filter(x => x.t >= cut).map(x => x.norm), older = a.filter(x => x.t < cut).map(x => x.norm);
      /* Trend: the number from the last four weeks vs. before that, when both have 3+ shots. */
      const trend = recent.length >= 3 && older.length >= 3 ? mean(recent) - mean(older) : null;
      return { carry: mean(vals), n: a.length, trend, list: a.slice().sort((x, y) => y.t - x.t) };
    };
    const all = [];
    clubs.forEach(c => swings.forEach(w => { const x = cell(c.id, w.k); if (x) all.push({ club: c, swing: w, ...x }); }));
    const prof = st.profile || {};
    const name = prof.name || p.name || "Player";
    /* Proximity rounds (approach shots from real rounds). Newest first; only rounds with shots count. */
    const rounds = (st.rounds || []).filter(r => r && Array.isArray(r.shots) && r.shots.length)
      .slice().sort((a, b) => (String(b.day) + (b.created || "")).localeCompare(String(a.day) + (a.created || "")));
    return { id: p.user_id, name, prof, joined: p.joined_at, swings, clubs, cell, all, rounds, hasState: !!p.state, coach: p.role === "coach" };
  }
  const level = n => (n >= 5 ? "hi" : n >= 2 ? "midc" : "lo");
  const initials = n => { const w = String(n).trim().split(/\s+/).filter(Boolean); return w.length ? (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase() : "?"; };
  const pm = sd => (sd == null ? "–" : "± " + Math.max(1, Math.round(sd)));
  const pm1 = sd => (sd == null ? "–" : "± " + sd.toFixed(1));
  const dateShort = iso => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const ago = iso => {
    if (!iso) return "–";
    const d = (Date.now() - Date.parse(iso)) / DAY;
    if (d < 1) return "today"; if (d < 2) return "yesterday"; if (d < 14) return Math.floor(d) + " days ago";
    return dateShort(iso);
  };
  const swingName = w => (w.label === "Full" ? "Full" : w.label);

  /* ---- proximity: the same math as the app (src/core/model.ts proxStat / PROX_RANGES / proxSplit) ---- */
  const PROX_RANGES = [
    { k: "u50", label: "Under 50", lo: 0, hi: 50 }, { k: "50", label: "50–75", lo: 50, hi: 75 }, { k: "75", label: "75–100", lo: 75, hi: 100 },
    { k: "100", label: "100–125", lo: 100, hi: 125 }, { k: "125", label: "125–150", lo: 125, hi: 150.0001 }, { k: "150", label: "150+", lo: 150.0001, hi: Infinity },
  ];
  const LIES = [["all", "All lies"], ["fairway", "Fairway"], ["rough", "Rough"], ["bunker", "Bunker"]];
  const ROUND_TYPES = { tournament: "Tournament", qualifying: "Qualifying", practice: "Practice round", casual: "Casual" };
  const proxRange = yd => (PROX_RANGES.find(r => yd >= r.lo && yd < r.hi) || PROX_RANGES[5]).k;
  const pstat = list => {
    const n = list.length; if (!n) return { n: 0, avg: null, green: 0, fringe: 0, in10: 0, in20: 0 };
    const c = f => list.filter(f).length;
    return { n, avg: list.reduce((a, x) => a + x.ft, 0) / n, green: c(x => x.finish === "green") / n, fringe: c(x => x.finish === "fringe") / n, in10: c(x => x.ft <= 10), in20: c(x => x.ft <= 20) };
  };
  const lieOk = x => view.lie === "all" || x.lie === view.lie;
  const shotsOf = rounds => rounds.flatMap(r => r.shots).filter(lieOk);
  const ft = v => (v == null ? "–" : Math.round(v) + " ft");
  const pct = v => Math.round(v * 100) + "%";
  const dayShort = d => { const t = new Date(d + "T12:00:00"); return isNaN(t) ? "–" : t.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  const dayLong = d => { const t = new Date(d + "T12:00:00"); return isNaN(t) ? "–" : t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  /* "Vs before": the latest 5 rounds vs older rounds, 3+ approaches on each side (same as the app). */
  const proxTrend = rounds => {
    const a = pstat(rounds.slice(0, 5).flatMap(r => r.shots).filter(lieOk)), b = pstat(rounds.slice(5).flatMap(r => r.shots).filter(lieOk));
    if (a.n < 3 || b.n < 3) return null;
    return Math.round(a.avg) - Math.round(b.avg);
  };
  const trendText = d => (d == null ? "" : d === 0 ? "Same as before" : d < 0 ? `${-d} ft closer than before` : `${d} ft farther than before`);
  const trendCls = d => (d == null || d === 0 ? "" : d < 0 ? "hi" : "lo");

  /* One floating tooltip for every chart mark (anything with data-tip). */
  const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
  const showTip = el => { const r = el.getBoundingClientRect(); tip.textContent = el.dataset.tip; tip.style.left = r.left + r.width / 2 + "px"; tip.style.top = r.top + "px"; tip.hidden = false; };
  document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el); else tip.hidden = true; });
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el); });
  document.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

  /* ---- signed out ---- */
  const title = (t, sub) => { const h = $("title"); if (h) h.textContent = t; const s = $("sub"); if (s) { s.hidden = !sub; s.innerHTML = sub || ""; } };
  let mode = /[?&]start=signup/.test(location.search) ? "signup" : "login";
  function login(msg) {
    const up = mode === "signup";
    title(up ? "Sign up your team" : "Coach login");
    html(`<div class="panel" style="max-width:520px;margin-top:12px">
      <div class="tabs" role="tablist"><button type="button" role="tab" id="t-in" aria-selected="${!up}">Log in</button><button type="button" role="tab" id="t-up" aria-selected="${up}">Sign up</button></div>
      <h2>${up ? "Create your coach account" : "Welcome back, coach"}</h2>
      <p class="muted">${up ? "Enter your school email and we’ll send you a link. Open it and you’ll set up your team next. No password needed." : "Enter your email and we’ll send you a link to your Coaching Dashboard. No password needed."}</p>
      <form id="f"><label class="field"><span>Email</span><input id="em" type="email" autocomplete="email" required placeholder="coach@school.edu"></label>
      <button class="btn" type="submit">${up ? "Email me a sign-up link" : "Email me a login link"}</button></form>
      <p id="m" class="${msg && msg.ok ? "ok" : "err"}">${esc(msg ? msg.text : "")}</p>
      <p class="muted" style="font-size:14px;margin-bottom:0">Open the link on this same device. ${up ? "" : "New here? Tap Sign up. "}<a href="teams.html">About WedgeLab Teams</a></p></div>`);
    $("t-in").onclick = () => { mode = "login"; login(); };
    $("t-up").onclick = () => { mode = "signup"; login(); };
    $("f").onsubmit = async e => {
      e.preventDefault();
      const email = $("em").value.trim();
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/coach.html" } });
      const m = $("m");
      if (error) { m.className = "err"; m.textContent = "That didn’t send. Check the email address and try again in a minute." + (error.message ? " (" + error.message + ")" : ""); return; }
      m.className = "ok"; m.textContent = "Check your email for the link."; clearDraft("em");
    };
  }

  function create(session) {
    title("Set up your team");
    html(`<div class="panel" style="max-width:560px;margin-top:12px">
      <h2>Set up your team</h2>
      <p class="muted">$499 a year for up to 12 players, plus free accounts for you and an assistant coach. $39 for each extra player.</p>
      <form id="f">
        <label class="field"><span>Team name</span><input id="tn" required maxlength="80" placeholder="Men’s Golf"></label>
        <label class="field"><span>School</span><input id="sc" required maxlength="80" placeholder="State University"></label>
        <label class="field"><span>Your name</span><input id="cn" maxlength="80" autocomplete="name" placeholder="Coach Smith"></label>
        <button class="btn" type="submit">Create team</button>
      </form><p id="m" class="err"></p>
      <p class="muted" style="font-size:14px;margin-bottom:0">Signed in as ${esc(session.user.email)} · <a href="#" id="out">Sign out</a></p></div>`);
    $("out").onclick = e => { e.preventDefault(); sb.auth.signOut(); };
    $("f").onsubmit = async e => {
      e.preventDefault();
      const row = { name: $("tn").value.trim(), school: $("sc").value.trim(), coach_name: $("cn").value.trim() || null, coach_id: session.user.id, coach_email: session.user.email };
      const { error } = await sb.from("teams").insert(row);
      if (error) { $("m").textContent = "Couldn’t create the team. Try again."; return; }
      clearDraft("tn", "sc", "cn");
      render();
    };
  }

  /* Back from Stripe: check quietly every few seconds and only redraw the page once the team is on. */
  let pollTimer = null;
  async function pollPaid() {
    pollTimer = null; paidChecks++;
    const { data } = await sb.from("teams").select("status").limit(1);
    if (data && data[0] && data[0].status === "active") return render();
    if (paidChecks < 30) pollTimer = setTimeout(pollPaid, 4000);
    else { const c = document.querySelector(".callout"); if (c) c.innerHTML = "<b>Payment received.</b> Switching your team on is taking longer than usual. Refresh this page in a minute, or email " + SUPPORT + " and we’ll switch it on."; }
  }

  /* ---- what the coach is looking at; kept across refreshes ---- */
  const view = { tab: "overview", player: null, cell: null, club: null, swing: null, sort: "name", dir: 1, q: "", lie: "all", mode: "rounds", month: null, lsort: "closest" };
  const fromHash = () => {
    const h = location.hash.slice(1);
    if (h.startsWith("player=")) { view.tab = "players"; view.player = decodeURIComponent(h.slice(7)); }
    else if (["overview", "players", "team"].includes(h)) { view.tab = h; view.player = null; }
    else if (h === "proximity") { view.tab = "overview"; view.player = null; }
  };
  fromHash();
  const go = (tab, player) => { view.tab = tab; view.player = player || null; if (!player) view.cell = null; const h = player ? "player=" + encodeURIComponent(player) : tab; if (location.hash.slice(1) !== h) history.pushState(null, "", "#" + h); draw(); window.scrollTo({ top: 0 }); };
  window.addEventListener("popstate", () => { fromHash(); draw(); });

  let shownAt = 0, last = null; // last = { session, team, players, invites }
  async function team(session, t) {
    const active = t.status === "active";
    if (justPaid && !active && paidChecks < 30 && !pollTimer) pollTimer = setTimeout(pollPaid, 4000);
    const [{ data: invites }, { data: roster }] = DEMO ? [{ data: window.WEDGELAB_DEMO.invites }, { data: window.WEDGELAB_DEMO.roster }] : await Promise.all([
      sb.from("team_invites").select("email,created_at,sent_at").eq("team_id", t.id).order("created_at"),
      sb.rpc("coach_roster"),
    ]);
    const inv = invites || [];
    /* Players added before the team was switched on get their emails the first time the coach opens the dashboard after. */
    if (!DEMO && active && !autoSent && inv.some(x => !x.sent_at)) { autoSent = true; await sendInvites(); return render(); }
    last = { session, t, active, players: (roster || []).map(analyze).filter(p => !p.coach), inv }; // coach accounts are not listed (Lou, Oct 22)
    shownAt = Date.now();
    draw();
  }

  function draw() {
    if (!last) return;
    const { t, active, players } = last;
    title(t.name, `${esc(t.school)} &nbsp;<span class="pill ${active ? "on" : "wait"}">${active ? "Active" : t.status === "ended" ? "Ended" : "Waiting for payment"}</span>`);
    const tabs = [["overview", "Dashboard"], ["players", "Roster"], ["team", "Settings"]]; // Lou, Oct 22: Dashboard / Roster / Settings
    const body = view.tab === "team" ? teamTab() : view.tab === "players" ? (view.player ? playerView() : playersTab()) : overviewTab();
    html(`${DEMO ? `<div class="callout" style="margin-bottom:16px"><b>Demo team.</b> Made-up players, practice shots and rounds to show how the dashboard works. Nothing here is real or saved. <a href="coach.html">Leave demo</a></div>` : ""}<div class="tabs" role="tablist" aria-label="Dashboard">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${view.tab === k}">${l}${k === "players" ? ` <span class="pill">${players.length}</span>` : ""}</button>`).join("")}
      <span class="sp"></span><button type="button" id="rf" title="Refresh">${ic("refresh")} <span class="hide-sm" id="upd">Refresh</span></button></div>${body}
      <p class="muted" style="font-size:14px;margin-top:28px">Signed in as ${esc(last.session.user.email)} · <a href="#" id="out">Sign out</a></p>`);
    app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => go(b.dataset.tab));
    $("rf").onclick = async () => { $("rf").disabled = true; $("rf").innerHTML = ic("refresh") + " Refreshing…"; await render(); };
    $("out").onclick = e => { e.preventDefault(); if (DEMO) { location.href = "coach.html"; return; } sb.auth.signOut(); };
    wire();
  }

  /* ---------- Players: sortable roster ---------- */
  function playersTab() {
    const { players } = last;
    if (!players.length) return `<div class="panel empty-state"><h3 style="color:var(--ink)">No players yet</h3><p>Players appear here once they join with your team code.</p><button class="btn" type="button" data-tab="team">Go to Settings</button></div>`;
    const q = view.q.trim().toLowerCase();
    const key = { name: p => p.name.toLowerCase(), joined: p => -(Date.parse(p.joined) || 0) }[view.sort] || (p => p.name.toLowerCase());
    const list = players.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * view.dir);
    const th = (k, l, cls = "") => `<th class="${cls}"><button type="button" data-sort="${k}" ${view.sort === k ? "data-on" : ""}>${l} ${ic("sort", 14)}</button></th>`;
    return `<div class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:14px"><h3 style="margin:0">Roster</h3><input class="search" id="q" data-draft="no" type="search" placeholder="Search players" value="${esc(view.q)}" style="max-width:280px" aria-label="Search players"></div>
      <div class="scroll"><table class="roster"><thead><tr>${th("name", "Player")}${th("joined", "Joined", "hide-sm")}<th></th></tr></thead><tbody>
      ${list.map(p => `<tr class="player" tabindex="0" data-player="${esc(p.id)}"><td><div class="who"><span class="av">${esc(initials(p.name))}</span><div><b>${esc(p.name)}</b>${p.coach ? ' <span class="pill">Coach</span>' : ""}<div class="muted" style="font-size:13px">${p.coach ? "Coach account" : esc([p.prof.handicap ? "Handicap " + p.prof.handicap : "", p.prof.level].filter(Boolean).join(" · ") || "WedgeLab player")}</div></div></div></td>
        <td class="hide-sm muted">${p.joined ? dateShort(p.joined) : "–"}</td><td class="go">${ic("chevron")}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No players match “${esc(view.q)}”.</td></tr>`}
      </tbody></table></div>
      <p class="muted" style="font-size:14px;margin:14px 0 0">Tap a player to see their proximity and wedge numbers.</p></div>`;
  }

  /* ---------- One player: numbers, trend, shots ---------- */
  function playerView() {
    const p = last.players.find(x => x.id === view.player);
    if (!p) return `<button class="back" type="button" data-tab="players">${ic("back")} Roster</button><div class="panel empty-state">This player isn’t on the team anymore.</div>`;
    const head = `<button class="back" type="button" data-tab="players">${ic("back")} Roster</button>
      <div class="panel" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><span class="av" style="width:56px;height:56px;font-size:20px">${esc(initials(p.name))}</span>
        <div style="flex:1;min-width:180px"><h2 style="margin:0">${esc(p.name)}</h2><div class="muted">${esc([p.prof.handicap ? "Handicap " + p.prof.handicap : "", p.prof.level, p.joined ? "Joined " + dateShort(p.joined) : ""].filter(Boolean).join(" · "))}</div></div></div>`;
    if (!p.hasState || !p.clubs.length) return head + `<div class="panel empty-state">${p.hasState ? "This player hasn’t finished setup yet." : "Numbers show once the team is active and the player has logged shots."}</div>` + (p.rounds.length ? playerProx(p) : "");
    if (!view.cell || !p.all.some(x => x.club.id + "|" + x.swing.k === view.cell)) { const top = p.all.slice().sort((a, b) => b.n - a.n)[0]; view.cell = top ? top.club.id + "|" + top.swing.k : null; }
    const arrow = tr => (tr == null || Math.abs(tr) < 1 ? "" : `<span class="tr" title="${tr > 0 ? "Up" : "Down"} ${Math.round(Math.abs(tr))} yd over the last 4 weeks">${ic(tr > 0 ? "up" : "down", 12)}${Math.round(Math.abs(tr))}</span>`);
    const mx = `<div class="scroll"><table class="mx"><thead><tr><th>Club</th>${p.swings.map(w => `<th>${esc(w.label)}</th>`).join("")}</tr></thead><tbody>
      ${p.clubs.map(c => `<tr><td class="cl">${esc(c.name)}${c.loft != null ? `<small>${esc(c.loft)}°</small>` : ""}</td>${p.swings.map(w => { const x = p.cell(c.id, w.k), k = c.id + "|" + w.k; return x
        ? `<td class="cell" tabindex="0" role="button" data-cell="${esc(k)}" aria-pressed="${view.cell === k}" aria-label="${esc(c.name)} ${esc(w.label)}: ${Math.round(x.carry)} yards, ${x.n} shots"><div class="n ${level(x.n)}">${Math.round(x.carry)}</div><div class="pm">${x.n} shot${x.n === 1 ? "" : "s"} ${arrow(x.trend)}</div></td>`
        : `<td class="cell empty">–</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div>
      <div class="legend"><span>Big number: carry in yards, normalized to 75°F at sea level</span><span>Small number: shots behind it</span><span>${ic("up", 12)} change over the last 4 weeks</span><span>Color: <b class="lo">0–1</b> · <b class="midc">2–4</b> · <b class="hi">5+</b> shots</span></div>`;
    const [cid, k] = (view.cell || "|").split("|");
    const c = p.clubs.find(x => x.id === cid), w = p.swings.find(x => x.k === k), x = c && w ? p.cell(cid, k) : null;
    /* Proximity (real-round results) first, then the wedge numbers (Lou, Oct 19). */
    return head + playerProx(p) + `<h3 class="sect">Wedge numbers</h3><div class="grid2"><div class="panel"><h3>Numbers</h3>${mx}</div>${x ? `<div class="panel">${detail(c, w, x)}</div>` : ""}</div>`;
  }
  function detail(c, w, x) {
    const vals = x.list.map(s => s.norm);
    let lo = Math.floor(Math.min(...vals, x.carry) - 2), hi = Math.ceil(Math.max(...vals, x.carry) + 2);
    if (hi - lo < 8) { const m = (hi + lo) / 2; lo = Math.floor(m - 4); hi = Math.ceil(m + 4); }
    const pct = v => ((v - lo) / (hi - lo)) * 100;
    const step = hi - lo > 30 ? 10 : hi - lo > 14 ? 5 : 2, ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    /* Dots stack upward when shots land on the same yard. */
    const stack = {};
    const dots = x.list.map(s => { const b = Math.round(s.norm); const lvl = (stack[b] = (stack[b] || 0) + 1) - 1; return `<span class="d" tabindex="0" style="left:${pct(s.norm)}%;bottom:${30 + lvl * 15}px" data-tip="${dateShort(s.shot.date)}: ${Math.round(s.norm)} yd normalized (${Math.round(s.shot.carry)} as hit, ${Math.round(s.shot.tempF)}°F, ${Math.round(s.shot.elevFt).toLocaleString()} ft)"></span>`; }).join("");
    const tr = x.trend;
    return `<h3>${esc(c.name)} · ${esc(w.label === "Full" ? "Full swing" : w.label + " swing")}</h3>
      <div class="tiles" style="grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 6px">
        <div class="tile" style="padding:14px"><div class="lbl">Number</div><div class="big" style="font-size:30px"><span class="${level(x.n)}">${Math.round(x.carry)}</span> <small>yd</small></div></div>
        <div class="tile" style="padding:14px"><div class="lbl">Shots</div><div class="big" style="font-size:30px">${x.n}</div></div>
        <div class="tile" style="padding:14px"><div class="lbl">4-week trend</div><div class="big" style="font-size:30px">${tr == null ? "–" : (tr >= 0.5 ? "+" : tr <= -0.5 ? "−" : "") + Math.round(Math.abs(tr))}</div><div class="sub" style="font-size:12px">${tr == null ? "needs 3 shots before and after" : "yards vs. before"}</div></div>
      </div>
      <div class="strip" role="img" aria-label="${x.n} shots between ${Math.round(Math.min(...vals))} and ${Math.round(Math.max(...vals))} yards; number ${Math.round(x.carry)}.">
        <span class="base"></span><span class="med" style="left:${pct(x.carry)}%"><span>${Math.round(x.carry)}</span></span>${dots}
        ${ticks.map(v => `<span class="tk" style="left:${pct(v)}%">${v}</span>`).join("")}
      </div>
      <p class="muted" style="font-size:13px;margin:4px 0 16px">Each dot is a shot, normalized to 75°F at sea level. Dashed line: the player’s number.</p>
      <div class="scroll"><table class="shots"><thead><tr><th>Date</th><th>Conditions</th><th class="r">As hit</th><th class="r">Normalized</th></tr></thead><tbody>
        ${x.list.slice(0, 10).map(s => `<tr><td>${dateShort(s.shot.date)}</td><td class="muted">${Math.round(s.shot.tempF)}°F, ${Math.round(s.shot.elevFt).toLocaleString()} ft</td><td class="r">${Math.round(s.shot.carry)}</td><td class="r"><b>${Math.round(s.norm)}</b></td></tr>`).join("")}
      </tbody></table></div>${x.n > 10 ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Latest 10 of ${x.n} shots.</p>` : ""}`;
  }

  /* ---------- Proximity: how close players hit approach shots in real rounds (Lou, Oct 19) ----------
     Results only: no activity (rounds this week, last played) and no consistency spread, same rules as the rest of the dashboard. */
  const lieChips = () => `<div class="chips" role="group" aria-label="Lie"><span class="lab">Lie</span>${LIES.map(([k, l]) => `<button type="button" class="chip" data-lie="${k}" aria-pressed="${view.lie === k}">${l}</button>`).join("")}</div>`;
  const lieWord = () => (view.lie === "all" ? "" : " from the " + view.lie);
  /* Three or four headline numbers. */
  function proxTiles(st, four, trend) {
    const t = (lbl, big, sub) => `<div class="tile"><div class="lbl">${lbl}</div><div class="big">${big}</div><div class="sub">${sub}</div></div>`;
    return `<div class="tiles ${four ? "t4" : ""}">
      ${t("Average proximity", st.avg == null ? "–" : `${Math.round(st.avg)} <small>ft</small>`, trend != null ? `<span class="${trendCls(trend)}">${trendText(trend)}</span>` : `${st.n} approach${st.n === 1 ? "" : "es"}`)}
      ${t("Greens hit", st.n ? pct(st.green) : "–", st.n ? `plus ${pct(st.fringe)} on the fringe` : "&nbsp;")}
      ${four ? t("Inside 10 ft", st.n ? pct(st.in10 / st.n) : "–", st.n ? `${st.in10} of ${st.n}` : "&nbsp;") : ""}
      ${t("Inside 20 ft", st.n ? pct(st.in20 / st.n) : "–", st.n ? `${st.in20} of ${st.n}` : "&nbsp;")}
    </div>`;
  }
  /* By distance: approaches, average proximity as a bar, greens hit. */
  function byDistance(shots, rounds) {
    const rows = PROX_RANGES.map(r => ({ r, list: shots.filter(x => proxRange(x.yd) === r.k) })).filter(x => x.r.k !== "u50" || x.list.length);
    const stats = rows.map(x => ({ ...x, st: pstat(x.list) }));
    const max = Math.max(30, ...stats.map(x => x.st.avg || 0));
    const top = Math.ceil(max / 10) * 10;
    const tr = rounds ? r => { const sel = rr => rr.map(o => ({ ...o, shots: o.shots.filter(x => proxRange(x.yd) === r.k) })); return proxTrend(sel(rounds)); } : null;
    return `<div class="scroll"><table class="pt"><thead><tr><th>Yards</th><th class="r"><span class="hide-sm">Approaches</span><span class="show-sm">Shots</span></th><th class="barh"><span class="hide-sm">Average proximity <span class="muted">(0–${top} ft)</span></span><span class="show-sm">Average</span></th><th class="r">Greens</th>${tr ? `<th class="r hide-sm">Vs before</th>` : ""}</tr></thead><tbody>
      ${stats.map(({ r, st }) => { const d = tr ? tr(r) : null; return `<tr><td class="yd">${r.label}</td>
        <td class="r"><span class="cnt"><i class="${level(st.n)}"></i>${st.n}</span></td>
        <td class="barh">${st.avg == null ? `<span class="muted">–</span>` : `<div class="hb" data-tip="${r.label} yd: ${Math.round(st.avg)} ft average over ${st.n} approach${st.n === 1 ? "" : "es"}" tabindex="0"><span style="width:${Math.max(2, (st.avg / top) * 100)}%"></span><b>${Math.round(st.avg)} ft</b></div>`}</td>
        <td class="r">${st.n ? pct(st.green) : "–"}</td>${tr ? `<td class="r hide-sm ${trendCls(d)}" style="font-size:14px;font-weight:700">${d == null ? `<span class="muted" style="font-weight:400">–</span>` : d === 0 ? "Same" : d < 0 ? `${-d} ft closer` : `${d} ft farther`}</td>` : ""}</tr>`; }).join("")}
    </tbody></table></div>
    <div class="legend"><span class="barnote">Bar: average distance from the hole after the approach. Shorter is closer.</span><span>Dot: <b class="lo">0–1</b> · <b class="midc">2–4</b> · <b class="hi">5+</b> approaches</span>${tr ? `<span class="hide-sm">Vs before: last 5 rounds vs older rounds</span>` : ""}</div>`;
  }
  /* ---------- Overview: the team inside 150 yards, from real rounds (Lou, Oct 19) ----------
     Lou: a coach decides on who hits it closest, who is trending better or worse, and whether the team is improving.
     Two ways to judge "trending": each player's last 5 rounds vs their earlier rounds, or one month vs the month before.
     The wedge-number compare chart was removed; each player's number matrix stays on their Players page. */
  const monthKey = d => String(d || "").slice(0, 7);
  const monthName = (k, long) => { const t = new Date(k + "-15T12:00:00"); return isNaN(t) ? k : t.toLocaleDateString(undefined, long ? { month: "long", year: "numeric" } : { month: "short", year: "numeric" }); };
  const prevMonth = k => { const [y, m] = k.split("-").map(Number); const d = new Date(y, m - 2, 15); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  const inMonth = (rounds, k) => rounds.filter(r => monthKey(r.day) === k);
  /* Change in feet (negative = closer), or null when either side has fewer than 3 approaches. */
  const change = (a, b) => { const x = pstat(a), y = pstat(b); return x.n >= 3 && y.n >= 3 ? Math.round(x.avg) - Math.round(y.avg) : null; };
  const chg = (d, short) => d == null ? `<span class="muted">–</span>` : d === 0 ? `<span class="muted">${short ? "Same" : "Same as before"}</span>`
    : `<span class="chg ${d < 0 ? "hi" : "lo"}">${ic(d < 0 ? "down" : "up", 13)}${Math.abs(d)} ft ${d < 0 ? "closer" : "farther"}</span>`;
  function overviewTab() {
    const players = last.players.filter(p => !p.coach);
    const withRounds = players.filter(p => p.rounds.length);
    const head = (extra = "") => `<div class="ovhead"><div><h3 style="margin:0 0 4px">Your team inside 150 yards</h3>
      <p class="muted" style="margin:0;font-size:15px;max-width:640px">How close your players hit approach shots in real rounds. Players log them in the app after each round (Data entry › Proximity).</p></div>${extra}</div>`;
    if (!players.length) return `<div class="panel empty-state"><h3 style="color:var(--ink)">No players yet</h3><p>Share your team code from Settings. Results show here as players log rounds.</p><button class="btn" type="button" data-tab="team">Go to Settings</button></div>`;
    if (!withRounds.length) return `<div class="panel">${head()}<div class="empty-state"><p style="margin:0">No rounds logged yet. Once players log approach shots from their rounds, you’ll see who hits it closest and who’s trending up or down.</p></div></div>`;
    /* Months with any approach (lie filter applied), newest first. */
    const months = [...new Set(withRounds.flatMap(p => p.rounds.filter(r => r.shots.some(lieOk)).map(r => monthKey(r.day))))].sort().reverse();
    if (view.mode === "month" && (!view.month || !months.includes(view.month))) view.month = months[0];
    const M = view.mode === "month" ? view.month : null, P = M ? prevMonth(M) : null;
    /* Per player: the period's shots, and the change vs before. */
    const rows = withRounds.map(p => {
      const now = M ? shotsOf(inMonth(p.rounds, M)) : shotsOf(p.rounds);
      const d = M ? change(now, shotsOf(inMonth(p.rounds, P))) : change(shotsOf(p.rounds.slice(0, 5)), shotsOf(p.rounds.slice(5)));
      return { p, st: pstat(now), d };
    });
    const live = rows.filter(r => r.st.n);
    const teamNow = M ? shotsOf(withRounds.flatMap(p => inMonth(p.rounds, M))) : shotsOf(withRounds.flatMap(p => p.rounds));
    const teamD = M ? change(teamNow, shotsOf(withRounds.flatMap(p => inMonth(p.rounds, P))))
      : change(shotsOf(withRounds.flatMap(p => p.rounds.slice(0, 5))), shotsOf(withRounds.flatMap(p => p.rounds.slice(5))));
    const team = pstat(teamNow);
    const vsWhat = M ? `vs ${monthName(P, true)}` : "last 5 rounds vs earlier rounds";
    const modeBar = `<div class="pickers" style="margin:20px 0 22px">
        <div class="seg" role="group" aria-label="Compare"><span class="lab">Compare</span><button type="button" data-mode="rounds" aria-pressed="${!M}">Last 5 rounds vs earlier</button><button type="button" data-mode="month" aria-pressed="${!!M}">Month by month</button></div>
        ${lieChips()}</div>
      ${M ? `<div class="chips months" role="group" aria-label="Month" style="margin:-8px 0 22px"><span class="lab">Month</span>${months.slice(0, 12).map(k => `<button type="button" class="chip" data-month="${k}" aria-pressed="${k === M}">${esc(monthName(k))}</button>`).join("")}</div>` : ""}`;
    /* Tiles: team average + change, greens, inside 20 ft. */
    const t = (lbl, big, sub) => `<div class="tile"><div class="lbl">${lbl}</div><div class="big">${big}</div><div class="sub">${sub}</div></div>`;
    const tiles = `<div class="tiles ov">
      ${t("Team average proximity", team.avg == null ? "–" : `${Math.round(team.avg)} <small>ft</small>`, teamD == null ? (M ? `${team.n} approach${team.n === 1 ? "" : "es"} in ${esc(monthName(M, true))}` : `${team.n} approaches`) : chg(teamD) + `<span class="vs">${esc(vsWhat)}</span>`)}
      ${t("Greens hit", team.n ? pct(team.green) : "–", team.n ? `plus ${pct(team.fringe)} on the fringe` : "&nbsp;")}
      ${t("Inside 20 ft", team.n ? pct(team.in20 / team.n) : "–", team.n ? `${team.in20} of ${team.n} approaches` : "&nbsp;")}
    </div>`;
    /* Team trend: month by month (always; it's the season at a glance). */
    const monthPts = months.slice(0, 12).reverse().map(k => { const st = pstat(shotsOf(withRounds.flatMap(p => inMonth(p.rounds, k)))); return st.n ? { label: monthName(k), y: st.avg, tip: `${monthName(k, true)}: ${Math.round(st.avg)} ft team average over ${st.n} approaches`, hl: k === M } : null; }).filter(Boolean);
    const trendPanel = `<div class="panel"><h3 style="margin-bottom:2px">Team trend</h3><p class="muted" style="margin:0 0 12px;font-size:15px">Team average proximity, month by month${lieWord()}.</p>
      ${monthPts.length >= 2 ? lineChart(monthPts, "Team average proximity by month", true) : `<div class="empty-state" style="padding:28px 8px">The trend line shows once there are rounds in 2 different months.</div>`}</div>`;
    /* Leaderboard. */
    const sort = view.lsort === "improved" ? (a, b) => (a.d == null) - (b.d == null) || (a.d - b.d) || (a.st.avg - b.st.avg) : (a, b) => a.st.avg - b.st.avg;
    const lb = live.slice().sort(sort);
    const missing = players.length - live.length;
    const board = `<div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:14px"><div><h3 style="margin:0 0 2px">Players</h3>
        <p class="muted" style="margin:0;font-size:15px">${M ? `${esc(monthName(M, true))}: average proximity and change ${esc(vsWhat)}.` : "Average proximity across all rounds, and change over the last 5 rounds vs earlier rounds."}</p></div>
        <div class="seg sm" role="group" aria-label="Sort players"><button type="button" data-lsort="closest" aria-pressed="${view.lsort !== "improved"}">Closest</button><button type="button" data-lsort="improved" aria-pressed="${view.lsort === "improved"}">Most improved</button></div></div>
      ${lb.length ? `<div class="scroll"><table class="pt lb"><thead><tr><th class="rk">#</th><th>Player</th><th class="r">Average</th><th class="r">Change</th><th class="r hide-sm">Greens</th><th class="r hide-sm">Approaches</th></tr></thead><tbody>
        ${lb.map((r, i) => `<tr class="player" tabindex="0" data-player="${esc(r.p.id)}"><td class="rk">${i + 1}</td><td><div class="who"><span class="av sm">${esc(initials(r.p.name))}</span><b>${esc(r.p.name)}</b></div></td>
          <td class="r big">${Math.round(r.st.avg)}<small> ft</small></td><td class="r">${chg(r.d, true)}</td><td class="r hide-sm">${pct(r.st.green)}</td><td class="r hide-sm"><span class="cnt"><i class="${level(r.st.n)}"></i>${r.st.n}</span></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty-state">No approaches${lieWord()} ${M ? "in " + esc(monthName(M, true)) : ""} yet.</div>`}
      <div class="legend"><span>Change needs 3+ approaches on each side.</span>${missing > 0 ? `<span>${missing} player${missing === 1 ? " has" : "s have"} no approaches${lieWord()}${M ? " this month" : ""} yet.</span>` : ""}<span class="hide-sm">Approaches dot: <b class="lo">0–1</b> · <b class="midc">2–4</b> · <b class="hi">5+</b></span><span>Tap a player for their rounds and wedge numbers.</span></div></div>`;
    /* Where the team loses shots: by distance, with change. */
    const dist = byDistanceTeam(withRounds, M, P);
    return `<div class="panel">${head()}${modeBar}${tiles}</div>${trendPanel}${board}
      <div class="panel"><h3 style="margin-bottom:2px">Where the team loses shots</h3><p class="muted" style="margin:0 0 16px;font-size:15px">The whole team by distance to the hole${M ? `, ${esc(monthName(M, true))}` : ""}. Longest bar = the range to practice.</p>${dist}</div>`;
  }
  function byDistanceTeam(players, M, P) {
    const nowR = M ? players.flatMap(p => inMonth(p.rounds, M)) : players.flatMap(p => p.rounds);
    const now = shotsOf(nowR);
    const sideA = M ? shotsOf(players.flatMap(p => inMonth(p.rounds, M))) : shotsOf(players.flatMap(p => p.rounds.slice(0, 5)));
    const sideB = M ? shotsOf(players.flatMap(p => inMonth(p.rounds, P))) : shotsOf(players.flatMap(p => p.rounds.slice(5)));
    const rows = PROX_RANGES.map(r => { const f = x => proxRange(x.yd) === r.k; return { r, st: pstat(now.filter(f)), d: change(sideA.filter(f), sideB.filter(f)) }; }).filter(x => x.r.k !== "u50" || x.st.n);
    const top = Math.ceil(Math.max(30, ...rows.map(x => x.st.avg || 0)) / 10) * 10;
    const worst = rows.filter(x => x.st.n >= 3).sort((a, b) => b.st.avg - a.st.avg)[0];
    return `<div class="scroll"><table class="pt"><thead><tr><th>Yards</th><th class="r"><span class="hide-sm">Approaches</span><span class="show-sm">Shots</span></th><th class="barh"><span class="hide-sm">Average proximity <span class="muted">(0–${top} ft)</span></span><span class="show-sm">Average</span></th><th class="r hide-sm">Greens</th><th class="r">Change</th></tr></thead><tbody>
      ${rows.map(({ r, st, d }) => `<tr${worst && worst.r.k === r.k ? ' class="worst"' : ""}><td class="yd">${r.label}</td>
        <td class="r"><span class="cnt"><i class="${level(st.n)}"></i>${st.n}</span></td>
        <td class="barh">${st.avg == null ? `<span class="muted">–</span>` : `<div class="hb" data-tip="${r.label} yd: ${Math.round(st.avg)} ft average over ${st.n} approach${st.n === 1 ? "" : "es"}" tabindex="0"><span style="width:${Math.max(2, (st.avg / top) * 100)}%"></span><b>${Math.round(st.avg)} ft</b></div>`}</td>
        <td class="r hide-sm">${st.n ? pct(st.green) : "–"}</td><td class="r">${chg(d, true)}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="legend"><span class="barnote">Bar: average distance from the hole after the approach. Shorter is closer.</span><span>Dot: <b class="lo">0–1</b> · <b class="midc">2–4</b> · <b class="hi">5+</b> approaches</span></div>`;
  }
  /* A plain line chart: one dot per point, labeled with its value. Higher = farther from the hole.
     Drawn at the real page width so labels stay readable on phones and big screens. */
  function lineChart(pts, aria, everyLabel) {
    const W = Math.max(300, Math.min(940, (app.clientWidth || 900) - 50)), H = W < 500 ? 220 : 260, L = 46, R = 22, T = 28, B = 40;
    const vals = pts.map(x => x.y), max = Math.max(...vals), min = Math.min(...vals);
    const lo = Math.max(0, min - Math.max(4, (max - min) * 0.35)), hi = max + Math.max(4, (max - min) * 0.35);
    const X = i => L + 14 + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - R - 28)), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const line = pts.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x.y).toFixed(1)}`).join(" ");
    const showLbl = i => everyLabel ? (pts.length <= 8 || W >= 600 || i % 2 === (pts.length - 1) % 2) : i === 0 || i === pts.length - 1;
    return `<svg class="tc" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}: from ${Math.round(pts[0].y)} feet to ${Math.round(pts[pts.length - 1].y)} feet">
      <line x1="${L}" y1="${T - 8}" x2="${L}" y2="${H - B}" class="ax"/><line x1="${L}" y1="${H - B}" x2="${W - R + 8}" y2="${H - B}" class="ax"/>
      <text class="axt" transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Proximity (ft)</text>
      <path d="${line}" class="ln"/>
      ${pts.map((x, i) => `<g tabindex="0" data-tip="${esc(x.tip)}"><circle cx="${X(i).toFixed(1)}" cy="${Y(x.y).toFixed(1)}" r="${x.hl ? 7 : 5.5}" class="pt${x.hl ? " hl" : ""}"/><text x="${X(i).toFixed(1)}" y="${(Y(x.y) - 13).toFixed(1)}" text-anchor="middle" class="pl">${Math.round(x.y)}</text></g>`).join("")}
      ${pts.map((x, i) => showLbl(i) ? `<text x="${X(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" class="dt">${esc(x.label)}</text>` : "").join("")}
    </svg>`;
  }
  function proxTrendChart(rounds) {
    const pts = rounds.slice(0, 10).map(r => ({ r, st: pstat(r.shots.filter(lieOk)) })).filter(x => x.st.n).reverse();
    if (pts.length < 2) return `<div class="empty-state" style="padding:28px 8px">The trend shows once there are 2 rounds${lieWord()}.</div>`;
    return lineChart(pts.map(x => ({ label: dayShort(x.r.day), y: x.st.avg, tip: `${dayLong(x.r.day)} · ${(x.r.course && x.r.course.name) || ""}: ${Math.round(x.st.avg)} ft over ${x.st.n} approach${x.st.n === 1 ? "" : "es"}` })), "Average proximity by round", false);
  }
  function playerProx(p) {
    const head = `<h3 style="margin:0 0 4px">Proximity</h3><p class="muted" style="margin:0;font-size:15px">Approach shots from real rounds: how far from the hole they finished.</p>`;
    if (!p.rounds.length) return `<div class="panel">${head}<div class="empty-state" style="padding:24px 8px 8px"><p style="margin:0">${esc(p.name)} hasn’t logged a round yet.</p></div></div>`;
    const shots = shotsOf(p.rounds), st = pstat(shots), tr = proxTrend(p.rounds);
    return `<div class="panel">${head}<div class="pickers" style="margin:18px 0 20px">${lieChips()}</div>${proxTiles(st, true, tr)}</div>
      <div class="panel"><h3 style="margin-bottom:2px">Round by round</h3><p class="muted" style="margin:0 0 12px;font-size:15px">Average proximity in each of the last ${Math.min(10, p.rounds.length)} rounds${lieWord()}.</p>${proxTrendChart(p.rounds)}</div>
      <div class="panel"><h3>By distance</h3>${byDistance(shots, p.rounds)}</div>
      <div class="panel"><h3>Rounds</h3><div class="scroll"><table class="shots"><thead><tr><th>Date</th><th>Course</th><th class="hide-sm">Round</th><th class="r hide-sm">Approaches</th><th class="r">Average</th><th class="r">Greens</th><th class="r hide-sm">Closest</th></tr></thead><tbody>
        ${p.rounds.filter(r => r.shots.some(lieOk)).slice(0, 15).map(r => { const s2 = pstat(r.shots.filter(lieOk)); return `<tr><td style="white-space:nowrap">${esc(dayShort(r.day))}</td><td>${esc(r.course && r.course.name || "–")}</td><td class="hide-sm muted">${esc(ROUND_TYPES[r.type] || "")}</td>
          <td class="r hide-sm">${s2.n}</td><td class="r" style="white-space:nowrap"><b>${ft(s2.avg)}</b></td><td class="r">${s2.n ? pct(s2.green) : "–"}</td><td class="r hide-sm">${s2.n ? ft(Math.min(...r.shots.filter(lieOk).map(x => x.ft))) : "–"}</td></tr>`; }).join("")}
      </tbody></table></div>${p.rounds.length > 15 ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Latest 15 of ${p.rounds.length} rounds.</p>` : ""}</div>`;
  }

  /* ---------- Team: billing, code, invites ---------- */
  function teamTab() {
    const { session, t, active, players, inv } = last;
    const invoiceHref = `mailto:${SUPPORT}?subject=${encodeURIComponent("WedgeLab Teams invoice: " + t.school)}&body=${encodeURIComponent("Team: " + t.name + "\nSchool: " + t.school + "\nTeam code: " + t.code + "\nPlayers: up to 12, plus 2 coach accounts (tell us if you need more players)\nPlease send an invoice for $499.")}`;
    const payHref = PAY_LINK ? PAY_LINK + "?client_reference_id=" + encodeURIComponent(t.id) + "&prefilled_email=" + encodeURIComponent(session.user.email || "") : "";
    const until = t.paid_until ? new Date(t.paid_until + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    const payBox = active ? (until ? `<p class="muted" style="font-size:15px;margin:10px 0 0">Active through ${esc(until)}.${t.stripe_subscription ? " It renews automatically each year." : ""}</p>` : "")
      : justPaid && t.status !== "ended" ? `<div class="callout" style="margin-top:16px"><b>Payment received, thank you.</b> Your team switches on in a few seconds. This page updates by itself.</div>`
      : `<div class="callout" style="margin-top:16px"><b>${t.status === "ended" ? "Your team’s year has ended." : "Switch your team on."}</b> ${t.status === "ended" ? "Renew to switch it back on for your players." : "Players can join as soon as your team is on."}
          ${payHref ? `<div class="row" style="margin-top:14px"><a class="btn" href="${esc(payHref)}">Pay $499 by card</a><a class="btn ghost" href="${invoiceHref}">Get an invoice instead</a></div>
          <p class="muted" style="font-size:14px;margin:10px 0 0">$499 a year for up to 12 players, plus free accounts for you and an assistant coach. Need more than 12 players? Get an invoice and tell us how many.</p>`
          : `<p style="margin:10px 0 0"><a href="${invoiceHref}">Email us for an invoice</a> and we’ll switch the team on as soon as it’s paid.</p>`}</div>`;
    return `<div class="grid2">
      <div>
        <div class="panel"><div class="row" style="justify-content:space-between"><div><h3 style="margin:0">${esc(t.name)}</h3><div class="muted">${esc(t.school)}</div></div><span class="pill ${active ? "on" : "wait"}">${active ? "Active" : t.status === "ended" ? "Ended" : "Waiting for payment"}</span></div>${payBox}</div>
        <div class="panel"><h3>Team code</h3>
          <div class="row"><span class="code" aria-label="Team code ${esc(t.code.split("").join(" "))}">${esc(t.code)}</span><button class="btn ghost" id="cp" type="button">${ic("copy")} Copy invite message</button></div>
          <p class="muted" style="font-size:15px;margin:12px 0 0">${players.filter(p => !p.coach).length} of ${t.seats} player spots used. Players enter this code in the app (Settings › Join a team) to join and get Pro.</p></div>
        ${t.coach_code ? `<div class="panel"><h3>Coach code</h3>
          <div class="row"><span class="code" aria-label="Coach code ${esc(t.coach_code.split("").join(" "))}">${esc(t.coach_code)}</span></div>
          <p class="muted" style="font-size:15px;margin:12px 0 0">For you and your assistant coach: two free WedgeLab Pro accounts that don’t use player spots. Enter it in the app the same way (Settings › Join a team). ${players.filter(p => p.coach).length} of ${t.coach_seats || 2} used. Keep this code to your coaching staff.</p></div>` : ""}
      </div>
      <div class="panel"><h3>Invite players</h3>
        <form id="add" class="row" style="flex-wrap:nowrap"><label class="field" style="flex:1;min-width:0;margin:0"><span style="position:absolute;left:-9999px">Player email</span><input id="pe" type="email" required placeholder="player@school.edu"></label><button class="btn" type="submit">Add</button></form>
        <p id="am" class="err" style="margin:8px 0 0"></p>
        ${inv.length ? `<div class="scroll"><table class="shots" style="margin-top:8px"><tbody>${inv.map(x => `<tr><td style="word-break:break-all">${esc(x.email)}</td><td class="muted" style="font-size:14px;white-space:nowrap">${x.sent_at ? "Invited " + ago(x.sent_at) : active ? "Not sent yet" : "Sends once your team is on"}</td>
          <td class="r" style="white-space:nowrap;font-size:14px">${active ? `<a href="#" data-send="${esc(x.email)}">${x.sent_at ? "Resend" : "Send"}</a> · ` : ""}<a href="#" data-rm="${esc(x.email)}">Remove</a></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No players added yet.</p>`}
        <p id="im" class="muted" style="font-size:14px;margin:12px 0 0">${active ? "Each player you add gets an email with your team code and how to join." : "Add your players now. They’ll get an email with your team code as soon as your team is on."}</p></div>
    </div>`;
  }

  function wire() {
    const L = last;
    app.querySelectorAll("[data-player]").forEach(el => {
      const open = e => { e.preventDefault(); go("players", el.dataset.player); };
      el.onclick = open; if (el.tagName === "TR") el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") open(e); };
    });
    app.querySelectorAll("[data-lie]").forEach(b => b.onclick = () => { view.lie = b.dataset.lie; const y = window.scrollY; draw(); window.scrollTo({ top: y }); });
    const keep = f => b => b.onclick = () => { f(b); const y = window.scrollY; draw(); window.scrollTo({ top: y }); };
    app.querySelectorAll("[data-mode]").forEach(keep(b => { view.mode = b.dataset.mode; }));
    app.querySelectorAll("[data-month]").forEach(keep(b => { view.month = b.dataset.month; }));
    app.querySelectorAll("[data-lsort]").forEach(keep(b => { view.lsort = b.dataset.lsort; }));
    app.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { if (view.sort === b.dataset.sort) view.dir *= -1; else { view.sort = b.dataset.sort; view.dir = 1; } draw(); });
    app.querySelectorAll("[data-cell]").forEach(td => { const pick = () => { view.cell = td.dataset.cell; draw(); }; td.onclick = pick; td.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }; });
    const q = $("q"); if (q) q.oninput = () => { view.q = q.value; const pos = q.selectionStart; draw(); const n = $("q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} };
    if (view.tab !== "team") return;
    const t = L.t, msg = `Join ${t.name} on WedgeLab. Download WedgeLab from the App Store, sign in, then open Settings (the gear on Home) → Join a team, and enter code ${t.code}.`;
    if (inviteNote) { const im = $("im"); im.className = "err"; im.textContent = inviteNote; inviteNote = ""; }
    $("cp").onclick = async () => { try { await navigator.clipboard.writeText(msg); $("cp").textContent = "Copied"; } catch { prompt("Copy this message:", msg); } };
    $("add").onsubmit = async e => {
      e.preventDefault();
      const email = $("pe").value.trim().toLowerCase();
      if (DEMO) { $("am").textContent = demoNote; return; }
      if (L.inv.length >= t.seats * 2) { $("am").textContent = "That’s a lot of invites. Remove some first."; return; }
      const { error } = await sb.from("team_invites").insert({ team_id: t.id, email });
      if (error) { $("am").textContent = /duplicate/i.test(error.message) ? "That player is already on the list." : "Couldn’t add that email. Check it and try again."; return; }
      clearDraft("pe");
      if (L.active) await sendInvites(email);
      render();
    };
    app.querySelectorAll("[data-send]").forEach(a => a.onclick = async e => { e.preventDefault(); if (DEMO) { a.textContent = demoNote; return; } a.textContent = "Sending…"; await sendInvites(a.dataset.send); render(); });
    app.querySelectorAll("[data-rm]").forEach(a => a.onclick = async e => { e.preventDefault(); if (DEMO) { a.textContent = demoNote; return; } await sb.from("team_invites").delete().eq("team_id", t.id).eq("email", a.dataset.rm); render(); });
  }

  /* Email invites through the send-invites function. A problem shows once, then the dashboard re-renders. */
  let inviteNote = "", autoSent = false;
  async function sendInvites(email) {
    try {
      const { data, error } = await sb.functions.invoke("send-invites", { body: email ? { email } : {} });
      if (error) throw error;
      inviteNote = data && data.failed && data.failed.length ? "Couldn’t email " + data.failed.join(", ") + ". Check the address, or use Copy invite message." : "";
    } catch {
      inviteNote = "Invite emails aren’t working right now. Use “Copy invite message” and send it yourself.";
    }
  }

  async function render() {
    if (DEMO) { // DEMO
      if (!window.WEDGELAB_DEMO) await new Promise(res => { const sc = document.createElement("script"); sc.src = "coach-demo.js?v=" + Date.now().toString(36).slice(0, 5); sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
      if (!window.WEDGELAB_DEMO) return html(`<p class="err">Couldn’t load the demo team. Refresh the page to try again.</p>`);
      return team(window.WEDGELAB_DEMO.session, window.WEDGELAB_DEMO.team);
    }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { last = null; return login(); }
    const { data: teams, error } = await sb.from("teams").select("*").limit(1);
    if (error) return html(`<p class="err">Couldn’t load your team. Refresh the page to try again.</p>`);
    if (!teams || !teams.length) { last = null; return create(session); }
    return team(session, teams[0]);
  }
  /* Keep numbers current: every minute while the page is on screen, and when the coach comes back to it.
     Skipped while the coach is typing so nothing they type is lost. */
  const quietRefresh = () => {
    if (document.hidden || !$("rf")) return;
    if (typing() || document.activeElement === $("q")) return;
    render();
  };
  setInterval(quietRefresh, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - shownAt > 10000) quietRefresh(); });
  if (!DEMO) sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") render(); });
  render();
})();
