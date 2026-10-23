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
    sort: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>', doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><path d="M9 13h6M9 17h4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.6" r="0.6" fill="currentColor"/>',
    check: '<polyline points="5 12.5 10 17 19 7"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
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
  const showTip = el => {
    const r = el.getBoundingClientRect(); tip.textContent = el.dataset.tip; tip.classList.toggle("wide", el.classList.contains("ii"));
    tip.style.left = r.left + r.width / 2 + "px"; tip.style.top = r.top + "px"; tip.hidden = false;
    /* Keep it on screen near the edges. */
    const t = tip.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    if (t.left < 8) tip.style.left = parseFloat(tip.style.left) + (8 - t.left) + "px"; else if (t.right > vw - 8) tip.style.left = parseFloat(tip.style.left) - (t.right - vw + 8) + "px";
  };
  /* ⓘ next to a heading: tap or hover to read what it means (Lou, Oct 22: replaces the gray fine print under tables). */
  const info = text => `<button type="button" class="ii" data-tip="${esc(text)}" aria-label="${esc(text)}">${ic("info", 15)}</button>`;
  document.addEventListener("click", e => { const el = e.target.closest && e.target.closest(".ii"); if (el) { e.preventDefault(); e.stopPropagation(); showTip(el); } else if (!(e.target.closest && e.target.closest("[data-tip]"))) tip.hidden = true; }, true);
  document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el); else tip.hidden = true; });
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el); });
  document.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

  /* ---- Team branding (Lou, Oct 22): the team's color fills the page header and its logo sits next to the name.
     Same color and logo on the team report. Default = WedgeLab navy. ---- */
  const NAVY = "#041E42";
  const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || "");
  const isLight = c => { const n = parseInt(c.slice(1), 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.35; };
  /* Lou, Oct 23: no custom team color, everything stays WedgeLab navy; the team logo stays. (teams.color is left unused.) */
  const teamColor = () => NAVY;
  function brand(t) {
    const h = document.querySelector(".pagehead"); if (!h) return;
    const c = teamColor(t);
    h.style.background = t ? c : "";
    h.classList.toggle("light", !!t && isLight(c));
    /* Charts (bars, trend lines) in the team's color; light colors fall back to navy so bars stay readable (Lou, Oct 22). */
    document.documentElement.style.setProperty("--tc", t && !isLight(c) ? c : NAVY);
    const lg = $("tlogo");
    if (lg) { const ok = t && t.logo && /^data:image\//.test(t.logo); lg.hidden = !ok; const im = lg.querySelector("img"); if (ok && im.getAttribute("src") !== t.logo) im.src = t.logo; if (ok) im.alt = (t.school || t.name || "Team") + " logo"; }
  }
  /* Shrink an uploaded logo to 256 px so it saves inside the team row (no storage bucket needed). */
  const shrinkLogo = file => new Promise((res, rej) => {
    const u = window.URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 256, h = img.naturalHeight || 256, k = Math.min(1, 256 / Math.max(w, h));
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); window.URL.revokeObjectURL(u);
      let out = cv.toDataURL("image/png"); if (out.length > 250000) out = cv.toDataURL("image/webp", 0.9);
      if (out.length > 390000) out = cv.toDataURL("image/jpeg", 0.85);
      out.length > 390000 ? rej(new Error("too big")) : res(out);
    };
    img.onerror = () => { window.URL.revokeObjectURL(u); rej(new Error("not an image")); };
    img.src = u;
  });

  /* ---- Count-up numbers and a soft fade when a tab opens (Lou, Oct 22). Only on opening a tab, never on a filter change or refresh. ---- */
  const calm = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cnt = (v, dec = 0) => v == null || !isFinite(v) ? "–" : `<span data-count="${v}" data-dec="${dec}">${dec ? Number(v).toFixed(dec) : Math.round(v)}</span>`;
  let animNext = true;
  function animate() {
    if (calm()) return;
    app.classList.remove("anim"); void app.offsetWidth; app.classList.add("anim");
    setTimeout(() => app.classList.remove("anim"), 1200);
    const els = [...app.querySelectorAll("[data-count]")], t0 = performance.now(), D = 750;
    const step = now => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      els.forEach(el => { const v = +el.dataset.count, d = +el.dataset.dec || 0; el.textContent = d ? (v * e).toFixed(d) : Math.round(v * e); });
      if (k < 1) requestAnimationFrame(step);
    };
    if (els.length) requestAnimationFrame(step);
  }

  /* ---- signed out ---- */
  const title = (t, sub) => { const h = $("title"); if (h) h.textContent = t; const s = $("sub"); if (s) { s.hidden = !sub; s.innerHTML = sub || ""; } };
  let mode = /[?&]start=signup/.test(location.search) ? "signup" : "login";
  function login(msg) {
    brand(null);
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
    brand(null);
    title("Set up your team");
    html(`<div class="panel" style="max-width:560px;margin-top:12px">
      <h2>Set up your team</h2>
      <p class="muted">$499 a year for up to 12 players, plus free accounts for you and an assistant coach. $39 for each extra player.</p>
      <form id="f">
        <label class="field"><span>Team name</span><input id="tn" required maxlength="80" placeholder="Men’s Golf"></label>
        <label class="field"><span>School</span><input id="sc" required maxlength="80" placeholder="State University"></label>
        <label class="field"><span>Team</span><select id="tg" required><option value="">Choose…</option><option value="men">Men’s team</option><option value="women">Women’s team</option></select></label>
        <label class="field"><span>Your name</span><input id="cn" maxlength="80" autocomplete="name" placeholder="Coach Smith"></label>
        <button class="btn" type="submit">Create team</button>
      </form><p id="m" class="err"></p>
      <p class="muted" style="font-size:14px;margin-bottom:0">Signed in as ${esc(session.user.email)} · <a href="#" id="out">Sign out</a></p></div>`);
    $("out").onclick = e => { e.preventDefault(); sb.auth.signOut(); };
    $("f").onsubmit = async e => {
      e.preventDefault();
      const row = { name: $("tn").value.trim(), school: $("sc").value.trim(), coach_name: $("cn").value.trim() || null, coach_id: session.user.id, coach_email: session.user.email, gender: $("tg").value || null };
      let { error } = await sb.from("teams").insert(row);
      /* Before supabase/team_gender.sql has been run, the column doesn't exist yet: save without it. */
      if (error && /gender/i.test(error.message || "")) { delete row.gender; ({ error } = await sb.from("teams").insert(row)); }
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
  const view = { tab: "overview", player: null, cell: null, club: null, swing: null, sort: "name", dir: 1, q: "", lie: "all", mode: "rounds", month: null, lsort: "closest", per: "90", cmp: "tour", dlie: "all", dplayer: "all", tdist: "all", osort: "avg", odir: 1 };
  const fromHash = () => {
    const h = location.hash.slice(1);
    if (h.startsWith("player=")) { view.tab = "players"; view.player = decodeURIComponent(h.slice(7)); }
    else if (["overview", "players", "team"].includes(h)) { view.tab = h; view.player = null; }
    else if (h === "proximity") { view.tab = "overview"; view.player = null; }
  };
  fromHash();
  const go = (tab, player) => { animNext = true; view.tab = tab; view.player = player || null; if (!player) view.cell = null; const h = player ? "player=" + encodeURIComponent(player) : tab; if (location.hash.slice(1) !== h) history.pushState(null, "", "#" + h); draw(); window.scrollTo({ top: 0 }); };
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
    brand(t);
    title(t.name, `${esc(t.school)} &nbsp;<span class="pill ${active ? "on" : "wait"}">${active ? "Active" : t.status === "ended" ? "Ended" : "Waiting for payment"}</span>`);
    const tabs = [["overview", "Dashboard"], ["players", "Roster"], ["team", "Settings"]]; // Lou, Oct 22: Dashboard / Roster / Settings
    const body = view.tab === "team" ? teamTab() : view.tab === "players" ? (view.player ? playerView() : playersTab()) : setupCard() + overviewTab();
    html(`${DEMO ? `<div class="callout" style="margin-bottom:16px"><b>Demo team.</b> Made-up players, practice shots and rounds to show how the dashboard works. Nothing here is real or saved. <a href="coach.html?start=signup">Sign up your team</a> · <a href="teams.html">Back to WedgeLab Teams</a></div>` : ""}<div class="tabs dtabs" role="tablist" aria-label="Dashboard">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${view.tab === k}">${l}${k === "players" ? ` <span class="pill">${players.length}</span>` : ""}</button>`).join("")}
      <span class="sp"></span><button type="button" id="rf" title="Refresh">${ic("refresh")} <span class="hide-sm" id="upd">Refresh</span></button></div>${body}
      <p class="muted" style="font-size:14px;margin-top:28px">Signed in as ${esc(last.session.user.email)} · <a href="#" id="out">Sign out</a></p>`);
    app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => go(b.dataset.tab));
    $("rf").onclick = async () => { $("rf").disabled = true; $("rf").innerHTML = ic("refresh") + " Refreshing…"; await render(); };
    $("out").onclick = e => { e.preventDefault(); if (DEMO) { location.href = "coach.html"; return; } sb.auth.signOut(); };
    wire();
    if (animNext) { animNext = false; animate(); }
  }

  /* ---------- Getting started (Lou, Oct 22): a checklist on the Dashboard for new coaches until everything is set up.
     "Hide" keeps it closed on this device. ---------- */
  const setupKey = () => "ww.coach.setupHidden." + (last && last.t ? last.t.id : "");
  function setupCard() {
    const { t, active, inv, players } = last;
    try { if (localStorage.getItem(setupKey())) return ""; } catch {}
    const steps = [
      ["Switch your team on", active, "Pay by card, or ask for an invoice if your school pays by purchase order."],
      ["Add your team logo", !!t.logo, "It shows at the top of your dashboard and on team reports."],
      ["Choose men’s or women’s team", !!t.gender, "Sets which benchmarks your team is compared with."],
      ["Invite your players", inv.length > 0 || players.length > 0, "Add their emails. Each player gets your team code."],
      ["Players join with your team code", players.length > 0, "In the app: Settings › Join a team."],
    ];
    const done = steps.filter(x => x[1]).length;
    if (done === steps.length) return "";
    const next = steps.findIndex(x => !x[1]);
    return `<div class="panel setup"><div class="row" style="justify-content:space-between;align-items:center;gap:12px">
        <div><h3 style="margin:0">Getting started</h3><div class="muted" style="font-size:14px">${done} of ${steps.length} done</div></div>
        <button type="button" class="linkbtn" id="sh">Hide</button></div>
      <div class="sbar" aria-hidden="true"><span style="width:${Math.round(done / steps.length * 100)}%"></span></div>
      <ol class="chk">${steps.map(([h, ok, sub], i) => `<li class="${ok ? "done" : i === next ? "next" : ""}"><span class="chk-n">${ok ? ic("check", 14) : i + 1}</span>
        <div class="chk-t"><b>${h}</b><span>${sub}</span></div>${!ok && i < 5 ? `<button type="button" class="btn ${i === next ? "" : "ghost"} sgo" data-tab="team">${i === next ? "Do this next" : "Settings"}</button>` : ""}</li>`).join("")}</ol></div>`;
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

  /* ---------- One player: proximity, then the number matrix and the spread of shots behind a number ---------- */
  function playerView() {
    const p = last.players.find(x => x.id === view.player);
    if (!p) return `<button class="back" type="button" data-tab="players">${ic("back")} Roster</button><div class="panel empty-state">This player isn’t on the team anymore.</div>`;
    const head = `<button class="back" type="button" data-tab="players">${ic("back")} Roster</button>
      <div class="panel" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><span class="av" style="width:56px;height:56px;font-size:20px">${esc(initials(p.name))}</span>
        <div style="flex:1;min-width:180px"><h2 style="margin:0">${esc(p.name)}</h2><div class="muted">${esc([p.prof.handicap ? "Handicap " + p.prof.handicap : "", p.prof.level, p.joined ? "Joined " + dateShort(p.joined) : ""].filter(Boolean).join(" · "))}</div></div>${playerSummary(p)}</div>`;
    if (!p.hasState || !p.clubs.length) return head + `<div class="panel empty-state">${p.hasState ? "This player hasn’t finished setup yet." : "Numbers show once the team is active and the player has logged shots."}</div>` + (p.rounds.length ? playerProx(p) : "");
    if (!view.cell || !p.all.some(x => x.club.id + "|" + x.swing.k === view.cell)) { const top = p.all.slice().sort((a, b) => b.n - a.n)[0]; view.cell = top ? top.club.id + "|" + top.swing.k : null; }
    const mx = `<div class="scroll"><table class="mx"><thead><tr><th>Club</th>${p.swings.map(w => `<th>${esc(w.label)}</th>`).join("")}</tr></thead><tbody>
      ${p.clubs.map(c => `<tr><td class="cl">${esc(c.name)}${c.loft != null ? `<small>${esc(c.loft)}°</small>` : ""}</td>${p.swings.map(w => { const x = p.cell(c.id, w.k), k = c.id + "|" + w.k; return x
        ? `<td class="cell" tabindex="0" role="button" data-cell="${esc(k)}" aria-pressed="${view.cell === k}" aria-label="${esc(c.name)} ${esc(w.label)}: ${Math.round(x.carry)} yards, ${x.n} shots"><div class="n ${level(x.n)}">${Math.round(x.carry)}</div><div class="pm">${x.n} shot${x.n === 1 ? "" : "s"}</div></td>`
        : `<td class="cell empty">–</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div>`;
    const [cid, k] = (view.cell || "|").split("|");
    const c = p.clubs.find(x => x.id === cid), w = p.swings.find(x => x.k === k), x = c && w ? p.cell(cid, k) : null;
    /* Proximity (real-round results) first, then the wedge numbers (Lou, Oct 19). */
    return head + playerProx(p) + `<h3 class="sect">Wedge numbers</h3><div class="grid2"><div class="panel"><h3 class="ih">Numbers ${info("Big number: carry in yards, normalized to 75°F at sea level. Small number: shots behind it. Color: red 0–1, yellow 2–4, green 5+ shots (same as the app).")}</h3>${mx}</div>${x ? `<div class="panel">${detail(c, w, x)}</div>` : ""}</div>`;
  }
  /* Summary strip at the top of a player's page (Lou, Oct 22): team rank, average, vs Tour/Scratch, change and a small
     line of the last 10 rounds, for the Dashboard's "Showing" period. */
  function playerSummary(p) {
    if (!p.rounds.length) return "";
    const per = view.per || "90", women = last.t.gender === "women", who = women ? "scratch" : (view.cmp || "tour"), B = BENCH[who];
    const ranked = last.players.filter(q => q.rounds.length).map(q => ({ q, st: dstat(windowShots(q.rounds, per).cur, who) })).filter(x => x.st.n >= 6).sort((a, b) => a.st.avg - b.st.avg);
    const w = windowShots(p.rounds, per), st = dstat(w.cur, who), d = change(w.recent, w.before), rank = ranked.findIndex(x => x.q.id === p.id);
    const pts = p.rounds.slice(0, 10).map(r => pstat(r.shots).avg).filter(v => v != null).reverse();
    let spark = `<span class="muted" style="font-size:13px">Needs 2 rounds</span>`;
    if (pts.length >= 2) {
      const W = 132, H = 38, lo = Math.min(...pts), hi = Math.max(...pts), X = i => 3 + i * (W - 6) / (pts.length - 1), Y = v => hi === lo ? H / 2 : H - 4 - (v - lo) / (hi - lo) * (H - 8); /* higher = farther, like the trend charts */
      spark = `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average proximity in the last ${pts.length} rounds, from ${Math.round(pts[0])} to ${Math.round(pts[pts.length - 1])} feet"><path d="${pts.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" ")}"/><circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(pts[pts.length - 1]).toFixed(1)}" r="3.5"/></svg>`;
    }
    const perName = (PERIODS.find(x => x[0] === per) || [, ""])[1];
    const item = (l, v, sub) => `<div class="psi"><div class="pl">${l}</div><div class="pv">${v}</div>${sub ? `<div class="ps">${sub}</div>` : ""}</div>`;
    return `<div class="psum"><div class="pper">${esc(perName)}</div><div class="psrow">
      ${item("Team rank", rank >= 0 ? `#${rank + 1}<small> of ${ranked.length}</small>` : "–", rank >= 0 ? "closest to the hole" : "needs 6+ approaches")}
      ${item("Average", st.n ? `${cnt(st.avg)}<small> ft</small>` : "–", `${st.n} approach${st.n === 1 ? "" : "es"}`)}
      ${item("vs " + esc(B.short), gapTxt(st.gap, who), "")}
      ${item("Change", chg(d, true), "")}
      ${item("Last 10 rounds", spark, pts.length >= 2 ? "higher = farther" : "")}</div></div>`;
  }
  function detail(c, w, x) {
    const vals = x.list.map(s => s.norm);
    let lo = Math.floor(Math.min(...vals, x.carry) - 2), hi = Math.ceil(Math.max(...vals, x.carry) + 2);
    if (hi - lo < 8) { const m = (hi + lo) / 2; lo = Math.floor(m - 4); hi = Math.ceil(m + 4); }
    const pct = v => ((v - lo) / (hi - lo)) * 100;
    const step = hi - lo > 30 ? 10 : hi - lo > 14 ? 5 : 2, ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    /* Dots stack upward when shots land on the same yard. */
    const stack = {};
    const dots = x.list.map(s => { const b = Math.round(s.norm); const lvl = (stack[b] = (stack[b] || 0) + 1) - 1; return `<span class="d" tabindex="0" style="left:${pct(s.norm)}%;bottom:${30 + lvl * 15}px" data-tip="${Math.round(s.norm)} yd normalized (${Math.round(s.shot.carry)} as hit, ${Math.round(s.shot.tempF)}°F, ${Math.round(s.shot.elevFt).toLocaleString()} ft)"></span>`; }).join("");
    return `<h3>${esc(c.name)} · ${esc(w.label === "Full" ? "Full swing" : w.label + " swing")}</h3>
      <div class="tiles" style="grid-template-columns:repeat(2,1fr);gap:10px;margin:12px 0 6px">
        <div class="tile" style="padding:14px"><div class="lbl">Number</div><div class="big" style="font-size:30px"><span class="${level(x.n)}">${Math.round(x.carry)}</span> <small>yd</small></div></div>
        <div class="tile" style="padding:14px"><div class="lbl">Shots</div><div class="big" style="font-size:30px">${x.n}</div></div>
      </div>
      <div class="strip" role="img" aria-label="${x.n} shots between ${Math.round(Math.min(...vals))} and ${Math.round(Math.max(...vals))} yards; number ${Math.round(x.carry)}.">
        <span class="base"></span><span class="med" style="left:${pct(x.carry)}%"><span>${Math.round(x.carry)}</span></span>${dots}
        ${ticks.map(v => `<span class="tk" style="left:${pct(v)}%">${v}</span>`).join("")}
      </div>
      <p class="muted" style="font-size:13px;margin:4px 0 0">Each dot is a shot, normalized to 75°F at sea level. Dashed line: the player’s number.</p>`;
  }

  /* ---------- Proximity: how close players hit approach shots in real rounds (Lou, Oct 19) ----------
     Results only: no activity (rounds this week, last played) and no consistency spread, same rules as the rest of the dashboard. */
  const lieChips = () => `<div class="chips" role="group" aria-label="Lie"><span class="lab">Lie</span>${LIES.map(([k, l]) => `<button type="button" class="chip" data-lie="${k}" aria-pressed="${view.lie === k}">${l}</button>`).join("")}</div>`;
  const lieWord = () => (view.lie === "all" ? "" : " from the " + view.lie);
  /* Three or four headline numbers. */
  function proxTiles(st, four, trend) {
    const t = (lbl, big, sub) => `<div class="tile"><div class="lbl">${lbl}</div><div class="big">${big}</div><div class="sub">${sub}</div></div>`;
    return `<div class="tiles ${four ? "t4" : ""}">
      ${t("Average proximity", st.avg == null ? "–" : `${cnt(st.avg)} <small>ft</small>`, trend != null ? `<span class="${trendCls(trend)}">${trendText(trend)}</span>` : `${st.n} approach${st.n === 1 ? "" : "es"}`)}
      ${t("Greens hit", st.n ? cnt(st.green * 100) + "%" : "–", st.n ? `plus ${pct(st.fringe)} on the fringe` : "&nbsp;")}
      ${(() => { const b = st.list ? st.list.filter(birdie).length : 0; return t("Birdie chances", st.n ? cnt(b / st.n * 100) + "%" : "–", st.n ? `${b} of ${st.n} on the green 12 ft & in` : "&nbsp;"); })()}
    </div>`;
  }
  /* By distance: approaches, average proximity as a bar, greens hit. */
  function byDistance(shots, rounds, who, teamShots) {
    const rows = PROX_RANGES.map(r => ({ r, list: shots.filter(x => proxRange(x.yd) === r.k) })).filter(x => x.r.k !== "u50" || x.list.length);
    /* Benchmark from the whole team's shots in that range, so it's the same number on every player's page (Lou, Oct 22). */
    const stats = rows.map(x => { const st = who ? dstat(x.list, who) : pstat(x.list); if (who && teamShots) st.ben = dstat(teamShots.filter(y => proxRange(y.yd) === x.r.k), who).ben; if (who && st.ben == null) st.ben = benchFixed(x.r.k, view.lie, who); return { ...x, st }; });
    const B = who ? BENCH[who] : null;
    const max = Math.max(30, ...stats.map(x => Math.max(x.st.avg || 0, x.st.ben || 0)));
    const top = Math.ceil(max / 10) * 10;
    const tr = rounds ? r => { const sel = rr => rr.map(o => ({ ...o, shots: o.shots.filter(x => proxRange(x.yd) === r.k) })); return proxTrend(sel(rounds)); } : null;
    return `<div class="scroll"><table class="pt"><thead><tr><th>Yards</th><th class="r"><span class="hide-sm">Approaches</span><span class="show-sm">Shots</span></th><th class="barh"><span class="hide-sm">Average proximity <span class="muted">(0–${top} ft)</span></span><span class="show-sm">Average</span> ${info("Bar: average distance from the hole after the approach. Shorter is closer." + (B ? " Gold dash: " + B.name + " average." : ""))}</th>${B ? `<th class="r">${esc(B.short)} ${info(B.name + " average from the team’s shots in that range (the same on every player’s page). No published number under 50 yards or from bunkers; rough is an estimate.")}</th>` : ""}<th class="r">Greens</th>${tr ? `<th class="r hide-sm">Vs before ${info("The last 5 rounds compared with older rounds (3+ approaches on each side).")}</th>` : ""}</tr></thead><tbody>
      ${stats.map(({ r, st }) => { const d = tr ? tr(r) : null; return `<tr><td class="yd">${r.label}</td>
        <td class="r">${st.n}</td>
        <td class="barh">${st.avg == null ? `<span class="muted">–</span>` : `<div class="hb" data-tip="${r.label} yd: ${Math.round(st.avg)} ft average over ${st.n} approach${st.n === 1 ? "" : "es"}${B && st.ben != null ? ` · ${esc(B.name)} ${Math.round(st.ben)} ft` : ""}" tabindex="0"><span style="${barW(st.avg, top)}"></span><b style="${lblPush(st.avg, B && st.ben, top)}">${Math.round(st.avg)} ft</b>${B && st.ben != null ? benchMark(st.ben, top, B) : ""}</div>`}</td>
        ${B ? `<td class="r">${st.ben != null ? ft(st.ben) : `<span class="muted">–</span>`}</td>` : ""}<td class="r">${st.n ? pct(st.green) : "–"}</td>${tr ? `<td class="r hide-sm ${trendCls(d)}" style="font-size:14px;font-weight:700">${d == null ? `<span class="muted" style="font-weight:400">–</span>` : d === 0 ? "Same" : d < 0 ? `${-d} ft closer` : `${d} ft farther`}</td>` : ""}</tr>`; }).join("")}
    </tbody></table></div>`;
  }
  /* ---------- Benchmarks (Lou, Oct 22) ----------
     Proximity: PGA Tour and scratch-golfer averages from the fairway, by distance (PGA Tour 2021-22 season and
     Arccos data for scratch golfers, as published by Golf Digest, Aug 2023). Rough = fairway x 1.65, an estimate
     from PGA Tour rough vs fairway averages (75-100 yd: 29'8" vs 17'6"; 150-175 yd: 45'2" vs 27'10").
     No published number under 50 yards or from bunkers, so those shots are left out of benchmark comparisons.
     Strokes gained: Mark Broadie's PGA Tour tables (average strokes to hole out by distance and lie, 2003-2010)
     and the PGA Tour putting curve. Approach SG = expected strokes before - expected strokes after - 1. */
  const BENCH = {
    tour: { name: "PGA Tour", short: "Tour", fw: { "50": 16.1, "75": 18.1, "100": 20.0, "125": 23.3, "150": 28.5 } },
    scratch: { name: "Scratch golfer", short: "Scratch", fw: { "50": 19.5, "75": 22.25, "100": 26.6, "125": 34.4, "150": 42.7 } },
  };
  const ROUGH_X = 1.65;
  const benchFt = (x, who) => {
    const v = BENCH[who].fw[proxRange(x.yd)];
    if (v == null || x.lie === "bunker") return null;
    return x.lie === "rough" ? v * ROUGH_X : v;
  };
  /* The published benchmark for a range and lie filter, shown when there are no shots to compare yet (Lou, Oct 22: always fill it in).
     All lies / fairway = fairway number; rough = fairway x 1.65; none from bunkers or under 50 yards. */
  const benchFixed = (k, lie, who) => { const v = BENCH[who].fw[k]; if (v == null || lie === "bunker") return null; return lie === "rough" ? v * ROUGH_X : v; };
  const RANGE_MID = { u50: 35, "50": 62.5, "75": 87.5, "100": 112.5, "125": 137.5, "150": 162 };
  /* Broadie, PGA Tour: average strokes to hole out (yards → strokes). */
  const SG_YD = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300];
  const SG_TAB = {
    fairway: [2.18, 2.40, 2.52, 2.60, 2.66, 2.70, 2.72, 2.75, 2.77, 2.80, 2.85, 2.91, 2.98, 3.08, 3.19, 3.32, 3.45, 3.58, 3.69, 3.78],
    rough: [2.34, 2.59, 2.70, 2.78, 2.87, 2.91, 2.93, 2.96, 2.99, 3.02, 3.08, 3.15, 3.23, 3.31, 3.42, 3.53, 3.64, 3.74, 3.83, 3.90],
    bunker: [2.43, 2.53, 2.66, 2.82, 2.92, 3.15, 3.21, 3.24, 3.24, 3.23, 3.21, 3.22, 3.28, 3.40, 3.55, 3.70, 3.84, 3.93, 4.00, 4.04],
  };
  const PUTT_FT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50, 60, 90];
  const PUTT = [0, 1.0, 1.01, 1.04, 1.13, 1.23, 1.34, 1.42, 1.50, 1.56, 1.61, 1.78, 1.87, 1.98, 2.06, 2.14, 2.21, 2.40];
  const interp = (xs, ys, v) => {
    if (v <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (v <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
    const n = xs.length - 1; return ys[n] + (ys[n] - ys[n - 1]) * (v - xs[n]) / (xs[n] - xs[n - 1]);
  };
  const holeOut = (lie, yd) => { const t = SG_TAB[lie] || SG_TAB.fairway; return yd >= 10 ? interp(SG_YD, t, yd) : t[0] - (10 - yd) * (lie === "rough" ? 0.015 : 0.01); };
  const afterShot = x => {
    if (x.ft <= 0) return 0;
    if (x.finish === "green") return interp(PUTT_FT, PUTT, x.ft);
    if (x.finish === "fringe") return interp(PUTT_FT, PUTT, x.ft) + 0.05;
    return holeOut(x.finish === "bunker" ? "bunker" : "rough", x.ft / 3);
  };
  const sgShot = x => holeOut(x.lie === "rough" || x.lie === "bunker" ? x.lie : "fairway", x.yd) - afterShot(x) - 1;
  /* Distance bars: the bar and the gold benchmark dash use the same scale (Lou, Oct 22). */
  const barW = (v, top) => `width:calc((100% - 64px) * ${Math.max(0.02, Math.min(1, v / top)).toFixed(4)})`;
  /* If the dash sits past the end of the bar (or right at it), the "17 ft" label moves past the dash so they never overlap. */
  const lblPush = (v, ben, top) => { if (ben == null) return ""; const fa = Math.max(0.02, Math.min(1, v / top)), fb = Math.min(1, ben / top);
    return fb > fa - 0.03 ? `margin-left:calc((100% - 64px) * ${Math.max(0, fb - fa).toFixed(4)} + 6px)` : ""; };
  const benchMark = (v, top, B) => `<i class="bm" aria-hidden="true" style="left:calc((100% - 64px) * ${Math.min(1, v / top).toFixed(4)})" title="${esc(B.name)} average: ${Math.round(v)} ft"></i>`;
  /* Birdie chance: on the green (or holed) 12 feet or closer, men's and women's teams alike (Lou, Oct 22). */
  const BIRDIE_FT = 12;
  const birdie = x => x.ft <= BIRDIE_FT && (x.finish === "green" || x.ft === 0);
  /* Everything the dashboard shows for one list of approach shots. */
  const dstat = (list, who) => {
    const st = pstat(list);
    const b = list.map(x => [x, benchFt(x, who)]).filter(z => z[1] != null);
    const you = b.length ? b.reduce((a, z) => a + z[0].ft, 0) / b.length : null, ben = b.length ? b.reduce((a, z) => a + z[1], 0) / b.length : null;
    return { ...st, birdie: list.length ? list.filter(birdie).length / list.length : 0,
      sg: list.length ? list.reduce((a, x) => a + sgShot(x), 0) / list.length : null, you, ben, gap: b.length >= 3 ? you - ben : null, nb: b.length };
  };

  /* ---------- Dashboard: the team inside 150 yards, from real rounds (Lou, Oct 22 redesign) ----------
     One "Showing" filter (last 30 days / last 90 days / all time) and one "Compare to" (PGA Tour / scratch).
     Three answer cards (closest, trending, what to practice), one sortable player table, by distance, team trend. */
  const monthKey = d => String(d || "").slice(0, 7);
  const monthName = (k, long) => { const t = new Date(k + "-15T12:00:00"); return isNaN(t) ? k : t.toLocaleDateString(undefined, long ? { month: "long", year: "numeric" } : { month: "short", year: "numeric" }); };
  const inMonth = (rounds, k) => rounds.filter(r => monthKey(r.day) === k);
  const dayT = d => Date.parse(d + "T12:00:00") || 0;
  const PERIODS = [["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"]];
  /* The period's shots and the comparison period's shots. All time compares the last 90 days with everything before. */
  const windowShots = (rounds, per) => {
    const now = Date.now(), len = (per === "30" ? 30 : 90) * DAY;
    const cur = per === "all" ? rounds : rounds.filter(r => dayT(r.day) > now - len);
    const recent = rounds.filter(r => dayT(r.day) > now - len), before = per === "all" ? rounds.filter(r => dayT(r.day) <= now - len) : rounds.filter(r => dayT(r.day) <= now - len && dayT(r.day) > now - 2 * len);
    const sh = rr => rr.flatMap(r => r.shots);
    return { cur: sh(cur), recent: sh(recent), before: sh(before), rounds: cur.length };
  };
  /* Change in feet (negative = closer), or null when either side has fewer than 3 approaches. */
  const change = (a, b) => { const x = pstat(a), y = pstat(b); return x.n >= 3 && y.n >= 3 ? Math.round(x.avg) - Math.round(y.avg) : null; };
  const chg = (d, short) => d == null ? `<span class="muted">–</span>` : d === 0 ? `<span class="muted">${short ? "Same" : "Same as before"}</span>`
    : `<span class="chg ${d < 0 ? "hi" : "lo"}">${ic(d < 0 ? "down" : "up", 13)}${Math.abs(d)} ft<span class="cw"> ${d < 0 ? "closer" : "farther"}</span></span>`;
  const gapTxt = (g, who) => g == null ? `<span class="muted">–</span>` : Math.round(g) === 0 ? `<span class="muted">Even with ${BENCH[who].short}</span>`
    : `<span class="chg ${g < 0 ? "hi" : "lo"}">${Math.abs(Math.round(g))} ft ${g < 0 ? "closer" : "farther"}</span>`;
  const sgTxt = v => v == null ? `<span class="muted">–</span>` : `<span class="${v >= 0.005 ? "hi" : v <= -0.005 ? "lo" : "muted"}" style="font-weight:800">${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}</span>`;
  const vsLine = per => per === "all" ? "Change compares the last 90 days with everything before." : `Change compares with the ${per} days before.`;

  function overviewTab() {
    const players = last.players.filter(p => !p.coach);
    const withRounds = players.filter(p => p.rounds.length);
    const women = last.t.gender === "women";
    const per = view.per || "90", who = women ? "scratch" : (view.cmp || "tour");
    if (!players.length) return `<div class="panel empty-state"><h3 style="color:var(--ink)">No players yet</h3><p>Share your team code from Settings. Results show here as players log rounds.</p><button class="btn" type="button" data-tab="team">Go to Settings</button></div>`;
    const bar = `<div class="dbar">
        <label><span>Showing</span><select id="per">${PERIODS.map(([k, l]) => `<option value="${k}"${k === per ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        ${women ? `<span class="fixedcmp"><span>Compare to</span><b>Scratch golfer</b></span>` : `<label><span>Compare to</span><select id="cmp">${Object.keys(BENCH).map(k => `<option value="${k}"${k === who ? " selected" : ""}>${BENCH[k].name}</option>`).join("")}</select></label>`}
        ${players.some(p => p.rounds.length) ? `<button type="button" class="btn ghost rpbtn" id="rpo">${ic("doc")} Team report (PDF)</button>` : ""}
        <p class="muted">${vsLine(per)} Approach shots from real rounds, logged by players in the app.</p></div>`;
    if (!withRounds.length) return bar + `<div class="panel empty-state"><p style="margin:0">No rounds logged yet. Once players log approach shots from their rounds, you’ll see who hits it closest, who’s trending, and what to practice.</p></div>`;
    /* The All players table can be narrowed to one distance range (Lou, Oct 22). */
    const td = view.tdist || "all", inTd = x => td === "all" || proxRange(x.yd) === td, tdLabel = (PROX_RANGES.find(r => r.k === td) || {}).label;
    const rows = withRounds.map(p => { const w = windowShots(p.rounds, per); return { p, st: dstat(w.cur.filter(inTd), who), d: change(w.recent.filter(inTd), w.before.filter(inTd)), rounds: w.rounds }; });
    const live = rows.filter(r => r.st.n);
    const tw = windowShots(withRounds.flatMap(p => p.rounds), per);
    const team = dstat(tw.cur, who), teamD = change(tw.recent, tw.before);
    const B = BENCH[who];
    const av = p => `<span class="av sm">${esc(initials(p.name))}</span>`;
    const line = (p, right) => `<div class="qr" data-player="${esc(p.id)}" tabindex="0" role="button">${av(p)}<span class="nm">${esc(p.name)}</span>${right}</div>`;
    /* Card 1: closest (6+ approaches so one good round doesn't top the list). */
    const closest = live.filter(r => r.st.n >= 6).sort((a, b) => a.st.avg - b.st.avg).slice(0, 3);
    const c1 = `<div class="qcard"><div class="qk">Who’s hitting it closest?</div><h3>Average distance from the hole</h3>
      ${closest.length ? closest.map(r => line(r.p, `<b class="qv">${cnt(r.st.avg)} ft</b>`)).join("") : `<p class="muted">Needs 6+ approaches per player in this period.</p>`}
      <p class="qf">Team: <b>${ft(team.avg)}</b>${teamD != null ? " · " + chg(teamD, true) : ""}${team.ben != null ? `<br>On comparable shots: team <b>${ft(team.you)}</b> · ${esc(B.short)} <b>${ft(team.ben)}</b>` : ""}</p></div>`;
    /* Card 2: trending (most improved first, biggest slide last). */
    const tr = live.filter(r => r.d != null && r.d !== 0).sort((a, b) => a.d - b.d);
    const up = tr.filter(r => r.d < 0).slice(0, 2), down = tr.filter(r => r.d > 0).slice(-1);
    const c2 = `<div class="qcard"><div class="qk">Who’s trending?</div><h3>${per === "all" ? "Last 90 days vs before" : `Vs the ${per} days before`}</h3>
      ${up.length || down.length ? [...up, ...down].map(r => line(r.p, chg(r.d, true))).join("") : `<p class="muted">Needs 3+ approaches in both periods.</p>`}
      <p class="qf">Most improved first, biggest slide last.</p></div>`;
    /* Card 3: what to practice = the distance with the biggest gap to the benchmark (5+ comparable shots). */
    const bands = PROX_RANGES.filter(r => B.fw[r.k] != null).map(r => ({ r, st: dstat(tw.cur.filter(x => proxRange(x.yd) === r.k), who) })).filter(x => x.st.nb >= 5 && x.st.gap != null);
    const worst = bands.slice().sort((a, b) => b.st.gap - a.st.gap)[0], best = bands.slice().sort((a, b) => a.st.gap - b.st.gap)[0];
    const c3 = `<div class="qcard"><div class="qk">What should we practice?</div><h3>Biggest gap to ${esc(B.name)}</h3>
      ${worst ? `<div class="focus" data-tip="Compared on the same shots: fairway and rough, ${esc(B.name)} averages"><div class="fv">${worst.r.label} yd</div><div class="muted">Team ${ft(worst.st.you)} · ${esc(B.short)} ${ft(worst.st.ben)} · ${pct(worst.st.green)} greens</div></div>
      ${best && best.r.k !== worst.r.k ? `<p class="qf">Closest to ${esc(B.short)}: <b>${best.r.label} yd</b> (${gapTxt(best.st.gap, who)})</p>` : ""}` : `<p class="muted">Needs 5+ approaches from 50 yards and out.</p>`}</div>`;
    /* Player table, sortable by clicking a column. */
    const cols = [["name", "Player"], ["avg", `<span class="hide-sm">Avg distance</span><span class="show-sm">Avg</span>`], ["gap", "vs " + B.short], ["d", "Change"], ["green", "Greens hit"], ["birdie", `<span class="hide-sm">Birdie chances (12 ft & in)</span><span class="show-sm">Birdie ≤12 ft</span>`], ["sg", "SG: Approach (vs PGA Tour)"], ["n", "Approaches"]].filter(c => !(women && c[0] === "sg"));
    const key = { name: r => r.p.name.toLowerCase(), avg: r => r.st.avg, gap: r => r.st.gap, d: r => r.d, green: r => -r.st.green, birdie: r => -r.st.birdie, sg: r => -(r.st.sg == null ? -9 : r.st.sg), n: r => -r.st.n }[view.osort || "avg"];
    const dir = view.odir || 1;
    const sorted = live.slice().sort((a, b) => { const x = key(a), y = key(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    const hideSm = new Set(["gap", "green", "sg", "n"]);
    const colInfo = { gap: `Average distance compared with ${B.name} averages from the same distances and lies.`, birdie: "Share of approaches that finished on the green 12 feet or closer to the hole (or holed).",
      sg: "Strokes gained per approach shot compared with a PGA Tour player from the same distance and lie. Above 0 = better than a tour pro.", d: vsLine(per).replace("Change compares", "Compared") };
    const missing = players.length - live.length;
    const table = `<div class="panel"><div class="row" style="justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px"><div><h3 style="margin:0 0 2px">All players</h3><span class="muted" style="font-size:14px">Click a column to sort · click a player to open</span></div>
      <label class="dsel"><span>Distance</span><select id="tdist"><option value="all"${td === "all" ? " selected" : ""}>All distances</option>${PROX_RANGES.map(r => `<option value="${r.k}"${r.k === td ? " selected" : ""}>${r.label} yd</option>`).join("")}</select></label></div>
      <div class="scroll"><table class="pt lb"><thead><tr>${cols.map(([k, l]) => `<th class="${k === "name" ? "" : "r"} ${hideSm.has(k) ? "hide-sm" : ""}"><button type="button" class="th" data-osort="${k}" ${(view.osort || "avg") === k ? "data-on" : ""}>${l}</button>${colInfo[k] ? info(colInfo[k]) : ""}</th>`).join("")}</tr></thead><tbody>
      ${sorted.map(r => `<tr class="player" tabindex="0" data-player="${esc(r.p.id)}"><td><div class="who">${av(r.p)}<b>${esc(r.p.name)}</b></div></td>
        <td class="r big">${cnt(r.st.avg)}<small> ft</small></td><td class="r hide-sm">${gapTxt(r.st.gap, who)}</td><td class="r">${chg(r.d, true)}</td>
        <td class="r hide-sm">${pct(r.st.green)}</td><td class="r">${pct(r.st.birdie)}</td>${women ? "" : `<td class="r hide-sm">${sgTxt(r.st.sg)}</td>`}<td class="r hide-sm">${r.st.n}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No approaches ${td === "all" ? "" : `from ${tdLabel} yards `}in this period yet.</td></tr>`}
      </tbody></table></div>
      ${missing > 0 ? `<p class="muted" style="font-size:13px;margin:12px 0 0">${missing} player${missing === 1 ? " has" : "s have"} no approaches ${td === "all" ? "" : `from ${tdLabel} yards `}in this period.</p>` : ""}</div>`;
    /* By distance (lie filter lives here) and team trend. */
    const dl = view.dlie || "all";
    /* Player filter (Lou, Oct 22): the whole team, or one player's approaches in the same period. */
    const dp = withRounds.find(p => p.id === view.dplayer) || null;
    if (!dp) view.dplayer = "all";
    const who1 = dp ? dp.name : "Team";
    const dShots = (dp ? windowShots(dp.rounds, per).cur : tw.cur).filter(x => dl === "all" || x.lie === dl);
    /* The benchmark columns (Tour / Scratch ft and Tour Shots to Hole Out) always come from the whole team's shots in that range,
       so they stay the same when a player is picked; only the player's own numbers change (Lou, Oct 22). */
    const teamL = tw.cur.filter(x => dl === "all" || x.lie === dl);
    const drows = PROX_RANGES.map(r => {
      const st = dstat(dShots.filter(x => proxRange(x.yd) === r.k), who), tb = dstat(teamL.filter(x => proxRange(x.yd) === r.k), who);
      const ben = tb.ben != null ? tb.ben : benchFixed(r.k, dl, who);
      return { r, st: { ...st, ben, gap: st.you != null && ben != null && st.nb >= 3 ? st.you - ben : null } };
    }).filter(x => x.r.k !== "u50" || x.st.n);
    const top = Math.ceil(Math.max(30, ...drows.map(x => Math.max(x.st.avg || 0, x.st.ben || 0))) / 10) * 10;
    const hl = dl === "bunker" ? null : drows.filter(x => x.st.gap != null && x.st.nb >= 5).sort((a, b) => b.st.gap - a.st.gap)[0];
    /* Tour Shots to Hole Out: what a PGA Tour pro averages to hole out from the team's own shots in that range
       (each shot's exact yardage and lie), so All lies reflects the real fairway/rough/bunker mix (Lou, Oct 22). */
    const tourFinish = list => list.length ? list.reduce((a, x) => a + holeOut(x.lie === "rough" || x.lie === "bunker" ? x.lie : "fairway", x.yd), 0) / list.length : null;
    const dist = `<div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:14px"><div><h3 style="margin:0 0 2px">By distance</h3><p class="muted" style="margin:0;font-size:15px">${dp ? esc(dp.name) + "’s" : "Team"} average distance from the hole, compared with the ${esc(B.name)}.${hl ? " Highlighted: the biggest gap." : ""}</p></div>
        <div class="dsels"><label class="dsel"><span>Player</span><select id="dplayer"><option value="all"${dp ? "" : " selected"}>All players</option>${withRounds.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${esc(p.id)}"${dp && dp.id === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label class="dsel"><span>Lie</span><select id="dlie">${LIES.map(([k, l]) => `<option value="${k}"${k === dl ? " selected" : ""}>${l}</option>`).join("")}</select></label></div></div>
      <div class="scroll"><table class="pt"><thead><tr><th>Yards</th><th class="r"><span class="hide-sm">Approaches</span><span class="show-sm">Shots</span></th><th class="barh"><span class="hide-sm">${dp ? "Average" : "Team average"} <span class="muted">(0–${top} ft)</span></span><span class="show-sm">${dp ? "Avg" : "Team"}</span> ${info("Bar: " + (dp ? who1 + "’s" : "team") + " average distance from the hole. Gold dash: " + B.name + " average.")}</th><th class="r">${esc(B.short)} ${info(B.name + " average from the team’s shots in that range and lie, so it stays the same for every player. No published number under 50 yards or from bunkers" + (dl !== "fairway" ? "; rough is an estimate." : "."))}</th><th class="r hide-sm">Greens</th>${women ? "" : `<th class="r hide-sm">Tour Shots to Hole Out ${info("How many shots a PGA Tour pro averages to hole out from the team’s shots in that range (same yardages and lies). Lower = easier shots.")}</th>`}</tr></thead><tbody>
      ${drows.map(({ r, st }) => { return `<tr${hl && hl.r.k === r.k ? ' class="worst"' : ""}><td class="yd">${r.label}</td><td class="r">${st.n}</td>
        <td class="barh">${st.avg == null ? `<span class="muted">–</span>` : `<div class="hb" data-tip="${r.label} yd: ${Math.round(st.avg)} ft ${dp ? esc(who1) + " average" : "team average"} over ${st.n} approach${st.n === 1 ? "" : "es"}${st.ben != null ? ` · ${esc(B.name)} ${Math.round(st.ben)} ft` : ""}" tabindex="0"><span style="${barW(st.avg, top)}"></span><b style="${lblPush(st.avg, st.ben, top)}">${Math.round(st.avg)} ft</b>${st.ben != null ? benchMark(st.ben, top, B) : ""}</div>`}</td>
        <td class="r">${st.ben != null ? ft(st.ben) : `<span class="muted">–</span>`}</td>
        <td class="r hide-sm">${st.n ? pct(st.green) : "–"}</td>${women ? "" : `<td class="r hide-sm">${(() => { const v = tourFinish(teamL.filter(x => proxRange(x.yd) === r.k)); return (v != null ? v : holeOut(dl === "rough" || dl === "bunker" ? dl : "fairway", RANGE_MID[r.k])).toFixed(2); })()}</td>`}</tr>`; }).join("")}
      </tbody></table></div>
</div>`;
    const months = [...new Set(withRounds.flatMap(p => p.rounds.map(r => monthKey(r.day))))].sort().reverse();
    const monthPts = months.slice(0, 12).reverse().map(k => { const st = pstat(withRounds.flatMap(p => inMonth(p.rounds, k)).flatMap(r => r.shots)); return st.n ? { label: monthName(k), y: st.avg, tip: `${monthName(k, true)}: ${Math.round(st.avg)} ft team average over ${st.n} approaches` } : null; }).filter(Boolean);
    const trend = `<div class="panel"><h3 style="margin-bottom:2px">Team trend</h3><p class="muted" style="margin:0 0 12px;font-size:15px">Team average distance from the hole, month by month. Lower is better.</p>
      ${monthPts.length >= 2 ? lineChart(monthPts, "Team average proximity by month", true) : `<div class="empty-state" style="padding:28px 8px">The trend line shows once there are rounds in 2 different months.</div>`}</div>`;
    return bar + `<div class="qcards">${c1}${c2}${c3}</div>` + table + dist + trend
      + `<p class="muted srcline">Where the benchmarks come from ${info((women ? "Women’s team: compared with scratch golfers (published LPGA averages by distance aren’t available yet). " : "") + "PGA Tour and scratch-golfer averages from the fairway (PGA Tour stats and Arccos data, via Golf Digest); rough estimated from tour rough vs fairway averages. Strokes gained uses Mark Broadie’s PGA Tour tables.")}</p>`;
  }
  /* A plain line chart: one dot per point, labeled with its value. Higher = farther from the hole.
     Drawn at the real page width so labels stay readable on phones and big screens. */
  function lineChart(pts, aria, everyLabel, fixedW) {
    const W = fixedW || Math.max(300, Math.min(940, (app.clientWidth || 900) - 50)), H = W < 500 ? 220 : 260, L = 46, R = 22, T = 28, B = 40;
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
    const women = last.t.gender === "women", who = women ? "scratch" : (view.cmp || "tour");
    return `<div class="panel">${head}<div class="pickers" style="margin:18px 0 20px">${lieChips()}</div>${proxTiles({ ...st, list: shots }, false, tr)}</div>
      <div class="panel"><h3 style="margin-bottom:2px">Round by round</h3><p class="muted" style="margin:0 0 12px;font-size:15px">Average proximity in each of the last ${Math.min(10, p.rounds.length)} rounds${lieWord()}.</p>${proxTrendChart(p.rounds)}</div>
      <div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:14px"><h3 style="margin:0">By distance</h3>
        ${women ? `<span class="fixedcmp"><span>Compare to</span><b>Scratch golfer</b></span>` : `<label class="dsel"><span>Compare to</span><select id="pcmp">${Object.keys(BENCH).map(k => `<option value="${k}"${k === who ? " selected" : ""}>${BENCH[k].name}</option>`).join("")}</select></label>`}</div>
        ${byDistance(shots, p.rounds, who, shotsOf(last.players.flatMap(q => q.rounds)))}</div>
      <div class="panel"><h3>Rounds</h3><div class="scroll"><table class="shots"><thead><tr><th>Date</th><th>Course</th><th class="hide-sm">Round</th><th class="r hide-sm">Approaches</th><th class="r">Average</th><th class="r">Greens</th><th class="r hide-sm">Closest</th></tr></thead><tbody>
        ${p.rounds.filter(r => r.shots.some(lieOk)).slice(0, 15).map(r => { const s2 = pstat(r.shots.filter(lieOk)); return `<tr><td style="white-space:nowrap">${esc(dayShort(r.day))}</td><td>${esc(r.course && r.course.name || "–")}</td><td class="hide-sm muted">${esc(ROUND_TYPES[r.type] || "")}</td>
          <td class="r hide-sm">${s2.n}</td><td class="r" style="white-space:nowrap"><b>${ft(s2.avg)}</b></td><td class="r">${s2.n ? pct(s2.green) : "–"}</td><td class="r hide-sm">${s2.n ? ft(Math.min(...r.shots.filter(lieOk).map(x => x.ft))) : "–"}</td></tr>`; }).join("")}
      </tbody></table></div>${p.rounds.length > 15 ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Latest 15 of ${p.rounds.length} rounds.</p>` : ""}</div>`;
  }

  /* ---------- Team report (Lou, Oct 22): a clean one-to-two page summary of the Dashboard, in the team's colors,
     for the coach to save as a PDF and share. Uses the Dashboard's current "Showing" and "Compare to". ---------- */
  function reportHTML() {
    const { t } = last, players = last.players;
    const women = t.gender === "women", per = view.per || "90", who = women ? "scratch" : (view.cmp || "tour"), B = BENCH[who];
    const withRounds = players.filter(p => p.rounds.length);
    const rows = withRounds.map(p => { const w = windowShots(p.rounds, per); return { p, st: dstat(w.cur, who), d: change(w.recent, w.before) }; }).filter(r => r.st.n);
    const tw = windowShots(withRounds.flatMap(p => p.rounds), per), team = dstat(tw.cur, who), teamD = change(tw.recent, tw.before);
    const perName = (PERIODS.find(x => x[0] === per) || [, ""])[1];
    const today = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    const c = teamColor(t), light = isLight(c);
    const kpi = (lbl, big, sub) => `<div class="rk"><div class="rkl">${lbl}</div><div class="rkb">${big}</div><div class="rks">${sub || "&nbsp;"}</div></div>`;
    const chgTxt = d => d == null ? "" : d === 0 ? "Same as before" : `${Math.abs(d)} ft ${d < 0 ? "closer" : "farther"} than before`;
    const closest = rows.filter(r => r.st.n >= 6).sort((a, b) => a.st.avg - b.st.avg).slice(0, 3);
    const improved = rows.filter(r => r.d != null && r.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);
    const bands = PROX_RANGES.filter(r => B.fw[r.k] != null).map(r => ({ r, st: dstat(tw.cur.filter(x => proxRange(x.yd) === r.k), who) })).filter(x => x.st.nb >= 5 && x.st.gap != null);
    const worst = bands.slice().sort((a, b) => b.st.gap - a.st.gap)[0];
    const list = (arr, val) => arr.length ? `<ol>${arr.map(r => `<li><span>${esc(r.p.name)}</span><b>${val(r)}</b></li>`).join("")}</ol>` : `<p class="rmuted">Not enough approaches yet.</p>`;
    const drows = PROX_RANGES.map(r => { const st = dstat(tw.cur.filter(x => proxRange(x.yd) === r.k), who); if (st.ben == null) st.ben = benchFixed(r.k, "all", who); return { r, st }; }).filter(x => x.r.k !== "u50" || x.st.n);
    const top = Math.ceil(Math.max(30, ...drows.map(x => Math.max(x.st.avg || 0, x.st.ben || 0))) / 10) * 10;
    const months = [...new Set(withRounds.flatMap(p => p.rounds.map(r => monthKey(r.day))))].sort().reverse();
    const monthPts = months.slice(0, 12).reverse().map(k => { const st = pstat(withRounds.flatMap(p => inMonth(p.rounds, k)).flatMap(r => r.shots)); return st.n ? { label: monthName(k), y: st.avg, tip: "" } : null; }).filter(Boolean);
    const sorted = rows.slice().sort((a, b) => a.st.avg - b.st.avg);
    return `<article class="rp" style="--team:${c}">
      <header class="rph${light ? " light" : ""}">${t.logo ? `<img class="rplogo" src="${esc(t.logo)}" alt="">` : ""}
        <div class="rpt"><div class="rpk">Team report · Inside 150 yards</div><h1>${esc(t.name)}</h1><div class="rps">${esc(t.school || "")}</div></div>
        <div class="rpm"><b>${esc(perName)}</b><span>${esc(today)}</span><span>Compared with ${esc(B.name)}</span></div></header>
      <section class="rkpis">
        ${kpi("Team average", ft(team.avg), chgTxt(teamD))}
        ${kpi("vs " + esc(B.short), team.gap == null ? "–" : Math.round(team.gap) === 0 ? "Even" : `${Math.abs(Math.round(team.gap))} ft ${team.gap < 0 ? "closer" : "farther"}`, team.ben != null ? `Team ${ft(team.you)} · ${esc(B.short)} ${ft(team.ben)}` : "")}
        ${kpi("Greens hit", team.n ? pct(team.green) : "–", team.n ? `plus ${pct(team.fringe)} on the fringe` : "")}
        ${kpi("Birdie chances", team.n ? pct(team.birdie) : "–", "on the green 12 ft & in")}
        ${women ? "" : kpi("SG: Approach", team.sg == null ? "–" : (team.sg >= 0 ? "+" : "−") + Math.abs(team.sg).toFixed(2), "per approach vs PGA Tour")}
        ${kpi("Approaches", tw.cur.length.toLocaleString(), `${tw.rounds} round${tw.rounds === 1 ? "" : "s"}`)}
      </section>
      <section class="rcols">
        <div class="rbox"><h3>Closest to the hole</h3>${list(closest, r => ft(r.st.avg))}</div>
        <div class="rbox"><h3>Most improved</h3>${list(improved, r => `${Math.abs(r.d)} ft closer`)}</div>
        <div class="rbox"><h3>Biggest gap to ${esc(B.short)}</h3>${worst ? `<div class="rfoc">${worst.r.label} yd</div><p class="rmuted">Team ${ft(worst.st.you)} · ${esc(B.short)} ${ft(worst.st.ben)} · ${pct(worst.st.green)} greens</p>` : `<p class="rmuted">Needs 5+ approaches from 50 yards and out.</p>`}</div>
      </section>
      <section><h2>All players</h2><table class="rtab"><thead><tr><th>Player</th><th class="r">Avg distance</th><th class="r">vs ${esc(B.short)}</th><th class="r">Change</th><th class="r">Greens</th><th class="r">Birdie chances</th>${women ? "" : `<th class="r">SG: Approach</th>`}<th class="r">Approaches</th></tr></thead><tbody>
        ${sorted.map(r => `<tr><td>${esc(r.p.name)}</td><td class="r"><b>${ft(r.st.avg)}</b></td><td class="r">${r.st.gap == null ? "–" : Math.round(r.st.gap) === 0 ? "Even" : `${Math.abs(Math.round(r.st.gap))} ft ${r.st.gap < 0 ? "closer" : "farther"}`}</td><td class="r">${r.d == null ? "–" : r.d === 0 ? "Same" : `${Math.abs(r.d)} ft ${r.d < 0 ? "closer" : "farther"}`}</td><td class="r">${pct(r.st.green)}</td><td class="r">${pct(r.st.birdie)}</td>${women ? "" : `<td class="r">${r.st.sg == null ? "–" : (r.st.sg >= 0 ? "+" : "−") + Math.abs(r.st.sg).toFixed(2)}</td>`}<td class="r">${r.st.n}</td></tr>`).join("") || `<tr><td colspan="8">No approaches in this period yet.</td></tr>`}
      </tbody></table></section>
      <section class="rnobreak"><h2>By distance</h2><table class="rtab"><thead><tr><th>Yards</th><th class="r">Approaches</th><th>Team average</th><th class="r">${esc(B.short)}</th><th class="r">Greens</th></tr></thead><tbody>
        ${drows.map(({ r, st }) => `<tr${worst && worst.r.k === r.k ? ' class="rw"' : ""}><td><b>${r.label}</b></td><td class="r">${st.n}</td><td class="rbar">${st.avg == null ? "–" : `<span class="rtrack"><i style="width:${(Math.min(1, st.avg / top) * 100).toFixed(1)}%"></i>${st.ben != null ? `<em style="left:${(Math.min(1, st.ben / top) * 100).toFixed(1)}%"></em>` : ""}</span><b>${ft(st.avg)}</b>`}</td><td class="r">${st.ben != null ? ft(st.ben) : "–"}</td><td class="r">${st.n ? pct(st.green) : "–"}</td></tr>`).join("")}
      </tbody></table><p class="rmuted">Bar: team average. Gold mark: ${esc(B.name)} average from the same shots. No published benchmark under 50 yards or from bunkers; rough is an estimate.</p></section>
      ${monthPts.length >= 2 ? `<section class="rnobreak"><h2>Team trend</h2><p class="rmuted" style="margin-top:-4px">Team average distance from the hole, month by month. Lower is better.</p>${lineChart(monthPts, "Team average proximity by month", true, 680)}</section>` : ""}
      <footer class="rpf"><span>Approach shots from real rounds, logged by players in the WedgeLab app. ${women ? "Women’s team: compared with scratch golfers. " : ""}Benchmarks: PGA Tour and scratch-golfer averages (PGA Tour stats and Arccos data, via Golf Digest)${women ? "" : "; strokes gained uses Mark Broadie’s PGA Tour tables"}.</span><b>WedgeLab · wedgelab.app</b></footer>
    </article>`;
  }
  function openReport() {
    closeReport();
    const w = document.createElement("div"); w.id = "rpw"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Team report");
    w.innerHTML = `<div class="rpbar"><button type="button" class="linkbtn" id="rpx">${ic("close")} Close</button><span class="hide-sm">Team report · ${esc(last.t.name)}</span><button type="button" class="btn" id="rpp">${ic("doc")} Save as PDF</button></div>
      <div class="rpscroll">${reportHTML()}<p class="rphint">Tap <b>Save as PDF</b>, then choose “Save as PDF” (computer) or Share › Save to Files (iPhone).</p></div>`;
    document.body.appendChild(w); document.body.classList.add("rp-open");
    const fname = document.title; document.title = `${last.t.name} team report`;
    $("rpx").onclick = closeReport; $("rpp").onclick = () => window.print();
    w.onkeydown = e => { if (e.key === "Escape") closeReport(); };
    w._title = fname; $("rpp").focus();
  }
  function closeReport() { const w = $("rpw"); if (!w) return; document.title = w._title || document.title; w.remove(); document.body.classList.remove("rp-open"); const b = $("rpo"); if (b) b.focus(); }

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
        <div class="panel"><h3>Team branding</h3><p class="muted" style="font-size:15px;margin:0 0 14px">Your logo shows at the top of your dashboard and on team reports.</p>
          <div class="brandrow"><div class="lgbox" style="background:${teamColor(t)}">${t.logo ? `<img src="${esc(t.logo)}" alt="Team logo">` : `<span>${ic("image", 26)}</span>`}</div>
            <div><label class="btn ghost filebtn">${ic("image")} ${t.logo ? "Change logo" : "Upload logo"}<input id="lf" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" data-draft="no"></label>
              ${t.logo ? `<button type="button" class="linkbtn" id="lr">Remove logo</button>` : ""}<div class="muted" style="font-size:13px;margin-top:6px">PNG with a see-through background looks best.</div></div></div>
          <p id="bm" class="muted" style="font-size:14px;margin:10px 0 0"></p></div>
        <div class="panel"><h3>Team type</h3><label class="dsel" style="margin-top:4px"><span>This is a</span><select id="tg2"><option value=""${!t.gender ? " selected" : ""}>Choose…</option><option value="men"${t.gender === "men" ? " selected" : ""}>Men’s team</option><option value="women"${t.gender === "women" ? " selected" : ""}>Women’s team</option></select></label>
          <p class="muted" id="tgm" style="font-size:14px;margin:10px 0 0">Women’s teams are compared with scratch golfers. Published LPGA averages by distance aren’t available yet.</p></div>
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
    app.querySelectorAll("[data-osort]").forEach(keep(b => { const k = b.dataset.osort; if ((view.osort || "avg") === k) view.odir = -(view.odir || 1); else { view.osort = k; view.odir = 1; } }));
    [["per", "per"], ["cmp", "cmp"], ["dlie", "dlie"], ["tdist", "tdist"], ["pcmp", "cmp"], ["dplayer", "dplayer"]].forEach(([id, k]) => { const el = $(id); if (el) el.onchange = () => { view[k] = el.value; const y = window.scrollY; draw(); window.scrollTo({ top: y }); }; });
    app.querySelectorAll(".qr[data-player]").forEach(el => el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("players", el.dataset.player); } });
    app.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { if (view.sort === b.dataset.sort) view.dir *= -1; else { view.sort = b.dataset.sort; view.dir = 1; } draw(); });
    app.querySelectorAll("[data-cell]").forEach(td => { const pick = () => { view.cell = td.dataset.cell; draw(); }; td.onclick = pick; td.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }; });
    const ro = $("rpo"); if (ro) ro.onclick = openReport;
    const sh = $("sh"); if (sh) sh.onclick = () => { try { localStorage.setItem(setupKey(), "1"); } catch {} const y = window.scrollY; draw(); window.scrollTo({ top: y }); };
    const q = $("q"); if (q) q.oninput = () => { view.q = q.value; const pos = q.selectionStart; draw(); const n = $("q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} };
    if (view.tab !== "team") return;
    const t = L.t, msg = `Join ${t.name} on WedgeLab. Download WedgeLab from the App Store, sign in, then open Settings (the gear on Home) → Join a team, and enter code ${t.code}.`;
    const tg2 = $("tg2"); if (tg2) tg2.onchange = async () => {
      if (DEMO) { L.t.gender = tg2.value || null; $("tgm").textContent = demoNote; return; }
      const { error } = await sb.from("teams").update({ gender: tg2.value || null }).eq("id", t.id);
      if (error) { $("tgm").className = "err"; $("tgm").textContent = "Couldn’t save that yet. (Run supabase/team_gender.sql once in Supabase.)"; return; }
      t.gender = tg2.value || null; $("tgm").className = "ok"; $("tgm").textContent = "Saved.";
    };
    /* Team branding: logo + color. Saved right away; the demo keeps changes on this page only. */
    const saveBrand = async (patch, okMsg) => {
      const m = $("bm"); m.className = "muted"; m.textContent = "Saving…";
      if (!DEMO) {
        const { error } = await sb.from("teams").update(patch).eq("id", t.id);
        if (error) { m.className = "err"; m.textContent = /logo|color/i.test(error.message || "") ? "Couldn’t save that yet. (Run supabase/team_brand.sql once in Supabase.)" : "Couldn’t save that. Try again."; return; }
      }
      Object.assign(t, patch); const y = window.scrollY; draw(); window.scrollTo({ top: y });
      const m2 = $("bm"); m2.className = DEMO ? "muted" : "ok"; m2.textContent = DEMO ? demoNote : okMsg;
    };
    const lf = $("lf"); if (lf) lf.onchange = async () => {
      const f = lf.files && lf.files[0]; if (!f) return;
      try { await saveBrand({ logo: await shrinkLogo(f) }, "Logo saved."); }
      catch { const m = $("bm"); m.className = "err"; m.textContent = "That file didn’t work. Use a PNG, JPG or SVG of your logo."; }
    };
    const lr = $("lr"); if (lr) lr.onclick = () => saveBrand({ logo: null }, "Logo removed.");
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
      if (/[?&]women=1/.test(location.search)) window.WEDGELAB_DEMO.team.gender = "women";
      if (/[?&]setup=1/.test(location.search)) Object.assign(window.WEDGELAB_DEMO.team, { logo: null, color: null, gender: null }); // preview the Getting started checklist
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
