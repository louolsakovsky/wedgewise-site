/* WedgeWise Coaching Dashboard. Coaches sign in with an emailed link, create their team, add players' emails,
   share the team code, and study their players' numbers: Overview (compare any club and swing),
   Players (sortable roster, then each player's numbers, trend and shots) and Team (billing, code, invites).
   Deliberately no activity tracking (no last active, shots this week, "locked in" counts), no consistency / ± spread and no gapping view: Lou, Oct 15.
   Data rules (who can see what) live in supabase/teams.sql. */
(function () {
  const URL = "https://hayymoyocfbjoaifgrnf.supabase.co";
  const KEY = "sb_publishable_VitLrXAoU4154mNLQxWf1g_GxGU8ON0";
  const SUPPORT = "wedgewisegolf@gmail.com";
  /* Stripe Payment Link for "WedgeWise Teams, $499 a year". Empty = card payment not switched on yet (invoice only).
     The team's id rides along as client_reference_id, so the stripe-webhook function knows which team to switch on. */
  const PAY_LINK = "https://buy.stripe.com/test_14A28s75Z7il09x2UF7ok00";
  const justPaid = /[?&]paid=1/.test(location.search);
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

  /* ---- the same math as the app: normalize to 75°F at sea level, then the median ---- */
  /* Effect grows with carry: 0.8% per 10°F and 1.3% per 1,000 ft for a 100-yard shot, scaled by carry / 100. */
  const factor = (t, e, std) => { const L = Math.max(0, std) / 100; return (1 + 0.008 * L * (t - 75) / 10) * (1 + 0.013 * L * e / 1000); };
  const toStd = (carry, t, e) => { let s = carry; for (let i = 0; i < 30; i++) { const n = carry / factor(t, e, s); if (Math.abs(n - s) < 1e-9) return n; s = n; } return s; };
  const median = a => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
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
      const trend = recent.length >= 3 && older.length >= 3 ? median(recent) - median(older) : null;
      return { carry: median(vals), n: a.length, trend, list: a.slice().sort((x, y) => y.t - x.t) };
    };
    const all = [];
    clubs.forEach(c => swings.forEach(w => { const x = cell(c.id, w.k); if (x) all.push({ club: c, swing: w, ...x }); }));
    const prof = st.profile || {};
    const name = prof.name || p.name || "Player";
    return { id: p.user_id, name, prof, joined: p.joined_at, swings, clubs, cell, all, hasState: !!p.state, coach: p.role === "coach" };
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
      <p class="muted" style="font-size:14px;margin-bottom:0">Open the link on this same device. ${up ? "" : "New here? Tap Sign up. "}<a href="teams.html">About WedgeWise Teams</a></p></div>`);
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
  const view = { tab: "overview", player: null, cell: null, club: null, swing: null, sort: "name", dir: 1, q: "" };
  const fromHash = () => {
    const h = location.hash.slice(1);
    if (h.startsWith("player=")) { view.tab = "players"; view.player = decodeURIComponent(h.slice(7)); }
    else if (["overview", "players", "team"].includes(h)) { view.tab = h; view.player = null; }
  };
  fromHash();
  const go = (tab, player) => { view.tab = tab; view.player = player || null; if (!player) view.cell = null; const h = player ? "player=" + encodeURIComponent(player) : tab; if (location.hash.slice(1) !== h) history.pushState(null, "", "#" + h); draw(); window.scrollTo({ top: 0 }); };
  window.addEventListener("popstate", () => { fromHash(); draw(); });

  let shownAt = 0, last = null; // last = { session, team, players, invites }
  async function team(session, t) {
    const active = t.status === "active";
    if (justPaid && !active && paidChecks < 30 && !pollTimer) pollTimer = setTimeout(pollPaid, 4000);
    const [{ data: invites }, { data: roster }] = await Promise.all([
      sb.from("team_invites").select("email,created_at,sent_at").eq("team_id", t.id).order("created_at"),
      sb.rpc("coach_roster"),
    ]);
    const inv = invites || [];
    /* Players added before the team was switched on get their emails the first time the coach opens the dashboard after. */
    if (active && !autoSent && inv.some(x => !x.sent_at)) { autoSent = true; await sendInvites(); return render(); }
    last = { session, t, active, players: (roster || []).map(analyze), inv };
    shownAt = Date.now();
    draw();
  }

  function draw() {
    if (!last) return;
    const { t, active, players } = last;
    title(t.name, `${esc(t.school)} &nbsp;<span class="pill ${active ? "on" : "wait"}">${active ? "Active" : t.status === "ended" ? "Ended" : "Waiting for payment"}</span>`);
    const tabs = [["overview", "Overview"], ["players", "Players"], ["team", "Team"]];
    const body = view.tab === "team" ? teamTab() : view.tab === "players" ? (view.player ? playerView() : playersTab()) : overviewTab();
    html(`<div class="tabs" role="tablist" aria-label="Dashboard">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${view.tab === k}">${l}${k === "players" ? ` <span class="pill">${players.length}</span>` : ""}</button>`).join("")}
      <span class="sp"></span><button type="button" id="rf" title="Refresh">${ic("refresh")} <span class="hide-sm" id="upd">Refresh</span></button></div>${body}
      <p class="muted" style="font-size:14px;margin-top:28px">Signed in as ${esc(last.session.user.email)} · <a href="#" id="out">Sign out</a></p>`);
    app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => go(b.dataset.tab));
    $("rf").onclick = async () => { $("rf").disabled = true; $("rf").innerHTML = ic("refresh") + " Refreshing…"; await render(); };
    $("out").onclick = e => { e.preventDefault(); sb.auth.signOut(); };
    wire();
  }

  /* ---------- Overview: team snapshot + compare any club and swing ---------- */
  function teamClubs(players) { const s = new Set(); players.forEach(p => p.clubs.forEach(c => s.add(c.name))); return BAG.filter(n => s.has(n)).concat([...s].filter(n => !BAG.includes(n))); }
  function teamSwings(players) { const m = new Map(); FRACTION.forEach(w => m.set(w.k, w)); players.forEach(p => p.swings.forEach(w => { if (!m.has(w.k)) m.set(w.k, w); })); return [...m.values()].filter(w => players.some(p => p.swings.some(x => x.k === w.k))); }
  function overviewTab() {
    const { t } = last; const players = last.players.filter(p => !p.coach);
    if (!players.length) return `<div class="panel empty-state"><h3 style="color:var(--ink)">No players yet</h3><p>Share your team code from the Team tab. Numbers show here as players log shots.</p><button class="btn" type="button" data-tab="team">Go to Team</button></div>`;
    const clubs = teamClubs(players), swings = teamSwings(players);
    if (!view.club || !clubs.includes(view.club)) view.club = clubs.includes("SW") ? "SW" : clubs[0];
    if (!view.swing || !swings.some(w => w.k === view.swing)) view.swing = (swings.find(w => w.k === "full") || swings[0] || {}).k;
    return `<div class="panel">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px"><h3 style="margin-bottom:2px">Compare the team</h3><span class="pill">${ic("team", 14)} ${players.length} of ${t.seats} players</span></div><p class="muted" style="margin:0 0 6px;font-size:15px">Pick a club and swing to see every player’s number side by side.</p>
        <div class="pickers"><div class="chips" role="group" aria-label="Club"><span class="lab" style="align-self:center">Club</span>${clubs.map(n => `<button type="button" class="chip" data-club="${esc(n)}" aria-pressed="${view.club === n}">${esc(n)}</button>`).join("")}</div>
          <div class="chips" role="group" aria-label="Swing"><span class="lab" style="align-self:center">Swing</span>${swings.map(w => `<button type="button" class="chip" data-swing="${esc(w.k)}" aria-pressed="${view.swing === w.k}">${esc(w.label)}</button>`).join("")}</div></div>
        ${compareChart(players, view.club, view.swing)}
      </div>`;
  }
  function compareChart(players, clubName, k) {
    const rows = players.map(p => { const c = p.clubs.find(x => x.name === clubName); const x = c && p.swings.some(w => w.k === k) ? p.cell(c.id, k) : null; return x ? { p, x } : null; }).filter(Boolean).sort((a, b) => b.x.carry - a.x.carry);
    const sw = teamSwings(players).find(w => w.k === k);
    if (!rows.length) return `<div class="empty-state">No shots on ${esc(clubName)} ${esc(sw ? sw.label : "")} yet.</div>`;
    let lo = Math.min(...rows.map(r => r.x.carry)), hi = Math.max(...rows.map(r => r.x.carry));
    lo = Math.floor((lo - 2) / 5) * 5; hi = Math.ceil((hi + 2) / 5) * 5; if (hi - lo < 10) hi = lo + 10;
    const pct = v => ((v - lo) / (hi - lo)) * 100;
    const step = hi - lo > 40 ? 10 : 5, ticks = []; for (let v = lo; v <= hi; v += step) ticks.push(v);
    const grid = ticks.map(v => `<span class="gl" style="left:${pct(v)}%"></span>`).join("");
    return `<div class="chart" role="table" aria-label="${esc(clubName)} ${esc(sw ? sw.label : "")}: each player's number">
      <div class="hd" role="columnheader">Player</div><div class="hd" role="columnheader" style="text-align:right">Yards</div><div class="hd" role="columnheader"><div class="axis">${ticks.map(v => `<span style="left:${pct(v)}%">${v}</span>`).join("")}</div></div>
      ${rows.map(({ p, x }) => `<div class="c nm" role="cell"><a href="#player=${encodeURIComponent(p.id)}" data-player="${esc(p.id)}">${esc(p.name)}</a></div>
        <div class="c v ${level(x.n)}" role="cell">${Math.round(x.carry)}</div>
        <div class="c" role="cell"><div class="rb" tabindex="0" data-tip="${esc(p.name)}: ${Math.round(x.carry)} yd · ${x.n} shot${x.n === 1 ? "" : "s"}">${grid}<b style="left:${pct(x.carry)}%"></b></div></div>`).join("")}
    </div>
    <div class="legend"><span><span class="dot" style="background:var(--navy)"></span>Player’s number (middle of their shots, normalized to 75°F at sea level)</span>
      <span>Number color: <b class="lo">0–1</b> · <b class="midc">2–4</b> · <b class="hi">5+</b> shots</span></div>`;
  }

  /* ---------- Players: sortable roster ---------- */
  function playersTab() {
    const { players } = last;
    if (!players.length) return `<div class="panel empty-state"><h3 style="color:var(--ink)">No players yet</h3><p>Players appear here once they join with your team code.</p><button class="btn" type="button" data-tab="team">Go to Team</button></div>`;
    const q = view.q.trim().toLowerCase();
    const key = { name: p => p.name.toLowerCase(), joined: p => -(Date.parse(p.joined) || 0) }[view.sort] || (p => p.name.toLowerCase());
    const list = players.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * view.dir);
    const th = (k, l, cls = "") => `<th class="${cls}"><button type="button" data-sort="${k}" ${view.sort === k ? "data-on" : ""}>${l} ${ic("sort", 14)}</button></th>`;
    return `<div class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:14px"><h3 style="margin:0">Players</h3><input class="search" id="q" data-draft="no" type="search" placeholder="Search players" value="${esc(view.q)}" style="max-width:280px" aria-label="Search players"></div>
      <div class="scroll"><table class="roster"><thead><tr>${th("name", "Player")}${th("joined", "Joined", "hide-sm")}<th></th></tr></thead><tbody>
      ${list.map(p => `<tr class="player" tabindex="0" data-player="${esc(p.id)}"><td><div class="who"><span class="av">${esc(initials(p.name))}</span><div><b>${esc(p.name)}</b>${p.coach ? ' <span class="pill">Coach</span>' : ""}<div class="muted" style="font-size:13px">${p.coach ? "Coach account" : esc([p.prof.handicap ? "Handicap " + p.prof.handicap : "", p.prof.level].filter(Boolean).join(" · ") || "WedgeWise player")}</div></div></div></td>
        <td class="hide-sm muted">${p.joined ? dateShort(p.joined) : "–"}</td><td class="go">${ic("chevron")}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No players match “${esc(view.q)}”.</td></tr>`}
      </tbody></table></div>
      <p class="muted" style="font-size:14px;margin:14px 0 0">Tap a player to see their numbers.</p></div>`;
  }

  /* ---------- One player: numbers, trend, shots ---------- */
  function playerView() {
    const p = last.players.find(x => x.id === view.player);
    if (!p) return `<button class="back" type="button" data-tab="players">${ic("back")} All players</button><div class="panel empty-state">This player isn’t on the team anymore.</div>`;
    const head = `<button class="back" type="button" data-tab="players">${ic("back")} All players</button>
      <div class="panel" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><span class="av" style="width:56px;height:56px;font-size:20px">${esc(initials(p.name))}</span>
        <div style="flex:1;min-width:180px"><h2 style="margin:0">${esc(p.name)}</h2><div class="muted">${esc([p.prof.handicap ? "Handicap " + p.prof.handicap : "", p.prof.level, p.joined ? "Joined " + dateShort(p.joined) : ""].filter(Boolean).join(" · "))}</div></div></div>`;
    if (!p.hasState || !p.clubs.length) return head + `<div class="panel empty-state">${p.hasState ? "This player hasn’t finished setup yet." : "Numbers show once the team is active and the player has logged shots."}</div>`;
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
    return head + `<div class="grid2"><div class="panel"><h3>Numbers</h3>${mx}</div>${x ? `<div class="panel">${detail(c, w, x)}</div>` : ""}</div>`;
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

  /* ---------- Team: billing, code, invites ---------- */
  function teamTab() {
    const { session, t, active, players, inv } = last;
    const invoiceHref = `mailto:${SUPPORT}?subject=${encodeURIComponent("WedgeWise Teams invoice: " + t.school)}&body=${encodeURIComponent("Team: " + t.name + "\nSchool: " + t.school + "\nTeam code: " + t.code + "\nPlayers: up to 12, plus 2 coach accounts (tell us if you need more players)\nPlease send an invoice for $499.")}`;
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
          <p class="muted" style="font-size:15px;margin:12px 0 0">For you and your assistant coach: two free WedgeWise Pro accounts that don’t use player spots. Enter it in the app the same way (Settings › Join a team). ${players.filter(p => p.coach).length} of ${t.coach_seats || 2} used. Keep this code to your coaching staff.</p></div>` : ""}
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
    app.querySelectorAll("[data-club]").forEach(b => b.onclick = () => { view.club = b.dataset.club; draw(); });
    app.querySelectorAll("[data-swing]").forEach(b => b.onclick = () => { view.swing = b.dataset.swing; draw(); });
    app.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { if (view.sort === b.dataset.sort) view.dir *= -1; else { view.sort = b.dataset.sort; view.dir = 1; } draw(); });
    app.querySelectorAll("[data-cell]").forEach(td => { const pick = () => { view.cell = td.dataset.cell; draw(); }; td.onclick = pick; td.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }; });
    const q = $("q"); if (q) q.oninput = () => { view.q = q.value; const pos = q.selectionStart; draw(); const n = $("q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} };
    if (view.tab !== "team") return;
    const t = L.t, msg = `Join ${t.name} on WedgeWise. Download WedgeWise from the App Store, sign in, then open Settings (the gear on Home) → Join a team, and enter code ${t.code}.`;
    if (inviteNote) { const im = $("im"); im.className = "err"; im.textContent = inviteNote; inviteNote = ""; }
    $("cp").onclick = async () => { try { await navigator.clipboard.writeText(msg); $("cp").textContent = "Copied"; } catch { prompt("Copy this message:", msg); } };
    $("add").onsubmit = async e => {
      e.preventDefault();
      const email = $("pe").value.trim().toLowerCase();
      if (L.inv.length >= t.seats * 2) { $("am").textContent = "That’s a lot of invites. Remove some first."; return; }
      const { error } = await sb.from("team_invites").insert({ team_id: t.id, email });
      if (error) { $("am").textContent = /duplicate/i.test(error.message) ? "That player is already on the list." : "Couldn’t add that email. Check it and try again."; return; }
      clearDraft("pe");
      if (L.active) await sendInvites(email);
      render();
    };
    app.querySelectorAll("[data-send]").forEach(a => a.onclick = async e => { e.preventDefault(); a.textContent = "Sending…"; await sendInvites(a.dataset.send); render(); });
    app.querySelectorAll("[data-rm]").forEach(a => a.onclick = async e => { e.preventDefault(); await sb.from("team_invites").delete().eq("team_id", t.id).eq("email", a.dataset.rm); render(); });
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
  sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") render(); });
  render();
})();
