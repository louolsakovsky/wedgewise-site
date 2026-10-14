/* WedgeWise coach page. Coaches sign in with an emailed link, create their team,
   add players' emails, share the team code and see each player's activity and numbers.
   Data rules (who can see what) live in supabase/teams.sql. */
(function () {
  const URL = "https://hayymoyocfbjoaifgrnf.supabase.co";
  const KEY = "sb_publishable_VitLrXAoU4154mNLQxWf1g_GxGU8ON0";
  const SUPPORT = "wedgewisegolf@gmail.com";
  const sb = window.supabase.createClient(URL, KEY, { auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true } });
  const app = document.getElementById("app");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const html = (h) => { app.innerHTML = h; };

  /* ---- the same math as the app: normalize to 75°F at sea level, then the median ---- */
  const factor = (t, e) => (1 + 0.010 * (t - 75) / 10) * (1 + 0.011 * e / 1000);
  const median = a => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const FRACTION = [{ k: "half", label: "½" }, { k: "tq", label: "¾" }, { k: "full", label: "Full" }];
  function numbers(st) {
    const swings = st.system === "custom" && st.custom && st.custom.efforts ? st.custom.efforts : FRACTION;
    const ok = (st.shots || []).filter(x => !x.wet && x.carry > 0 && x.tempF != null && x.elevFt != null && swings.some(w => w.k === x.swing));
    const cells = {};
    ok.forEach(x => { (cells[x.clubId + "|" + x.swing] = cells[x.clubId + "|" + x.swing] || []).push(x.carry / factor(x.tempF, x.elevFt)); });
    return { swings, clubs: st.clubs || [], cell: (c, k) => { const a = cells[c + "|" + k]; return a ? { carry: median(a), n: a.length } : null; } };
  }
  const level = n => (n >= 5 ? "hi" : n >= 2 ? "midc" : "lo");
  const ago = iso => {
    if (!iso) return "Not yet";
    const d = (Date.now() - Date.parse(iso)) / 864e5;
    if (d < 1) return "Today"; if (d < 2) return "Yesterday"; if (d < 14) return Math.floor(d) + " days ago";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  /* ---- screens ---- */
  /* Signed out: "Log in" for coaches who already have a team, "Sign up" for new ones.
     Both send an email link (no passwords); a new coach goes on to set up their team. */
  const title = t => { const h = document.getElementById("title"); if (h) h.textContent = t; };
  let mode = /[?&]start=signup/.test(location.search) ? "signup" : "login";
  function login(msg) {
    const up = mode === "signup";
    title(up ? "Sign up your team" : "Coach login");
    html(`<div class="panel" style="max-width:520px">
      <div class="tabs" role="tablist"><button type="button" role="tab" id="t-in" aria-selected="${!up}">Log in</button><button type="button" role="tab" id="t-up" aria-selected="${up}">Sign up</button></div>
      <h2>${up ? "Create your coach account" : "Welcome back, coach"}</h2>
      <p class="muted">${up ? "Enter your school email and we’ll send you a link. Open it and you’ll set up your team next. No password needed." : "Enter your email and we’ll send you a link to your Coaching Dashboard. No password needed."}</p>
      <form id="f"><label class="field"><span>Email</span><input id="em" type="email" autocomplete="email" required placeholder="coach@school.edu"></label>
      <button class="btn" type="submit">${up ? "Email me a sign-up link" : "Email me a login link"}</button></form>
      <p id="m" class="${msg && msg.ok ? "ok" : "err"}">${esc(msg ? msg.text : "")}</p>
      <p class="muted" style="font-size:14px">Open the link on this same device. ${up ? "" : "New here? Tap Sign up. "}<a href="teams.html">About WedgeWise Teams</a></p></div>`);
    document.getElementById("t-in").onclick = () => { mode = "login"; login(); };
    document.getElementById("t-up").onclick = () => { mode = "signup"; login(); };
    document.getElementById("f").onsubmit = async e => {
      e.preventDefault();
      const email = document.getElementById("em").value.trim();
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/coach.html" } });
      const m = document.getElementById("m");
      if (error) { m.className = "err"; m.textContent = "That didn’t send. Check the email address and try again in a minute."; return; }
      m.className = "ok"; m.textContent = "Check your email for the link.";
    };
  }

  function create(session) {
    title("Set up your team");
    html(`<div class="panel" style="max-width:560px">
      <h2>Set up your team</h2>
      <p class="muted">$499 a year for up to 12 players, then $39 for each extra player.</p>
      <form id="f">
        <label class="field"><span>Team name</span><input id="tn" required maxlength="80" placeholder="Men’s Golf"></label>
        <label class="field"><span>School</span><input id="sc" required maxlength="80" placeholder="Penn State University"></label>
        <label class="field"><span>Your name</span><input id="cn" maxlength="80" autocomplete="name" placeholder="Coach Smith"></label>
        <button class="btn" type="submit">Create team</button>
      </form><p id="m" class="err"></p>
      <p class="muted" style="font-size:14px">Signed in as ${esc(session.user.email)} · <a href="#" id="out">Sign out</a></p></div>`);
    document.getElementById("out").onclick = e => { e.preventDefault(); sb.auth.signOut(); };
    document.getElementById("f").onsubmit = async e => {
      e.preventDefault();
      const row = { name: document.getElementById("tn").value.trim(), school: document.getElementById("sc").value.trim(), coach_name: document.getElementById("cn").value.trim() || null, coach_id: session.user.id, coach_email: session.user.email };
      const { error } = await sb.from("teams").insert(row);
      if (error) { document.getElementById("m").textContent = "Couldn’t create the team. Try again."; return; }
      render();
    };
  }

  /* Players whose numbers are open stay open when the page refreshes. */
  const open = new Set();
  let shownAt = 0;
  async function team(session, t) {
    title("Coaching Dashboard");
    const active = t.status === "active";
    const [{ data: invites }, { data: roster }] = await Promise.all([
      sb.from("team_invites").select("email,created_at,sent_at").eq("team_id", t.id).order("created_at"),
      sb.rpc("coach_roster"),
    ]);
    const players = roster || [], inv = invites || [];
    const msg = `Join ${t.name} on WedgeWise. Download WedgeWise from the App Store, sign in with Apple, then open Settings (the gear on Home) → Join a team, and enter code ${t.code}.`;
    const rows = players.map((p, i) => {
      const st = p.state || {}, shots = st.shots || [];
      const week = shots.filter(x => Date.parse(x.date) > Date.now() - 7 * 864e5).length;
      const nm = numbers(st); let locked = 0;
      nm.clubs.forEach(c => nm.swings.forEach(w => { const x = nm.cell(c.id, w.k); if (x && x.n >= 5) locked++; }));
      const isOpen = open.has(p.user_id);
      return `<tr class="player" data-i="${i}" data-u="${esc(p.user_id)}" tabindex="0" aria-expanded="${isOpen}"><td><b>${esc((st.profile && st.profile.name) || p.name || "Player")}</b><br><span class="muted" style="font-size:13px">Joined ${ago(p.joined_at)}</span></td>
        <td>${ago(p.last_active)}</td><td>${week}</td><td class="hide-sm">${shots.length}</td><td class="hide-sm">${locked}</td></tr>
        <tr class="detail" id="d${i}"${isOpen ? "" : " hidden"}><td colspan="5">${matrix(st)}</td></tr>`;
    }).join("");
    html(`
      <div class="panel">
        <div class="row" style="justify-content:space-between">
          <div><h2 style="margin:0">${esc(t.name)}</h2><div class="muted">${esc(t.school)}</div></div>
          <span class="pill ${active ? "on" : "wait"}">${active ? "Active" : t.status === "ended" ? "Ended" : "Waiting for payment"}</span>
        </div>
        ${active ? "" : `<div class="callout" style="margin-top:16px"><b>Switch your team on.</b> Card payment is coming soon. For now, <a href="mailto:${SUPPORT}?subject=${encodeURIComponent("WedgeWise Teams: " + t.school)}&body=${encodeURIComponent("Team: " + t.name + "\nSchool: " + t.school + "\nPlayers: up to 12\nPlease send an invoice for $499.")}">email us for an invoice</a> and we’ll switch the team on as soon as it’s paid. Players can’t join until then.</div>`}
      </div>
      <div class="panel">
        <h3>Team code</h3>
        <div class="row"><span class="code" aria-label="Team code ${esc(t.code.split("").join(" "))}">${esc(t.code)}</span><button class="btn ghost" id="cp">Copy invite message</button></div>
        <p class="muted" style="font-size:14px;margin-bottom:0">${players.length} of ${t.seats} spots used. Players enter this code in the app to join and get Pro.</p>
      </div>
      <div class="panel">
        <h3>Players to invite</h3>
        <form id="add" class="row"><label class="field" style="flex:1;min-width:220px;margin:0"><span class="sr" style="position:absolute;left:-9999px">Player email</span><input id="pe" type="email" required placeholder="player@school.edu"></label><button class="btn" type="submit">Add</button></form>
        <p id="am" class="err"></p>
        ${inv.length ? `<ul style="padding-left:18px">${inv.map(x => `<li>${esc(x.email)} <a href="#" data-rm="${esc(x.email)}" style="font-size:14px">Remove</a></li>`).join("")}</ul>` : `<p class="muted">No players added yet.</p>`}
        <p class="muted" style="font-size:14px;margin-bottom:0">Automatic invite emails are coming soon. Until then, use “Copy invite message” above and send it to your players.</p>
      </div>
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Roster</h3><button class="btn ghost" id="rf" type="button">Refresh</button></div>
        <p class="muted" id="upd" style="font-size:13px;margin-top:0">Updated just now. Updates every minute.</p>
        ${players.length ? `<div class="scroll"><table class="roster"><thead><tr><th>Player</th><th>Last active</th><th>Shots this week</th><th class="hide-sm">Total shots</th><th class="hide-sm">Numbers locked in</th></tr></thead><tbody>${rows}</tbody></table></div>
          <p class="muted" style="font-size:14px">Tap a player to see their numbers. Colors show how many shots each number is built on: red 0–1, yellow 2–4, green 5+.</p>`
        : `<p class="muted">No players have joined yet.</p>`}
      </div>
      <p class="muted" style="font-size:14px">Signed in as ${esc(session.user.email)} · <a href="#" id="out">Sign out</a></p>`);
    document.getElementById("out").onclick = e => { e.preventDefault(); sb.auth.signOut(); };
    shownAt = Date.now();
    document.getElementById("rf").onclick = async () => { const b = document.getElementById("rf"); b.textContent = "Refreshing…"; b.disabled = true; await render(); };
    document.getElementById("cp").onclick = async () => { try { await navigator.clipboard.writeText(msg); document.getElementById("cp").textContent = "Copied"; } catch { prompt("Copy this message:", msg); } };
    document.getElementById("add").onsubmit = async e => {
      e.preventDefault();
      const email = document.getElementById("pe").value.trim().toLowerCase();
      if (inv.length >= t.seats * 2) { document.getElementById("am").textContent = "That’s a lot of invites. Remove some first."; return; }
      const { error } = await sb.from("team_invites").insert({ team_id: t.id, email });
      if (error) { document.getElementById("am").textContent = /duplicate/i.test(error.message) ? "That player is already on the list." : "Couldn’t add that email. Check it and try again."; return; }
      render();
    };
    app.querySelectorAll("[data-rm]").forEach(a => a.onclick = async e => { e.preventDefault(); await sb.from("team_invites").delete().eq("team_id", t.id).eq("email", a.dataset.rm); render(); });
    app.querySelectorAll("tr.player").forEach(tr => {
      const toggle = () => { const d = document.getElementById("d" + tr.dataset.i); d.hidden = !d.hidden; tr.setAttribute("aria-expanded", String(!d.hidden)); if (d.hidden) open.delete(tr.dataset.u); else open.add(tr.dataset.u); };
      tr.onclick = toggle; tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
    });
  }

  function matrix(st) {
    if (!st || !st.shots) return `<p class="muted">Numbers show once the team is active and the player has logged shots.</p>`;
    const nm = numbers(st);
    if (!nm.clubs.length) return `<p class="muted">This player hasn’t finished setup yet.</p>`;
    return `<div class="scroll"><table class="mx"><thead><tr><th>Club</th>${nm.swings.map(w => `<th>${esc(w.label)}</th>`).join("")}</tr></thead><tbody>
      ${nm.clubs.map(c => `<tr><td><b>${esc(c.name)}</b>${c.loft != null ? ` <span class="muted" style="font-weight:400;font-size:12px">${esc(c.loft)}°</span>` : ""}</td>${nm.swings.map(w => { const x = nm.cell(c.id, w.k); return x ? `<td class="${level(x.n)}" title="${x.n} shots">${Math.round(x.carry)}</td>` : `<td class="muted">–</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div><p class="muted" style="font-size:13px;margin:0">Baseline carry in yards, normalized to 75°F at sea level.</p>`;
  }

  async function render() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return login();
    const { data: teams, error } = await sb.from("teams").select("*").limit(1);
    if (error) return html(`<p class="err">Couldn’t load your team. Refresh the page to try again.</p>`);
    if (!teams || !teams.length) return create(session);
    return team(session, teams[0]);
  }
  /* Keep the roster current: every minute while the page is on screen, and when the coach comes back to it.
     Skipped while the coach is typing an email so nothing they type is lost. */
  const quietRefresh = () => {
    if (document.hidden || !document.getElementById("rf")) return;
    const pe = document.getElementById("pe");
    if (pe && (pe.value || document.activeElement === pe)) return;
    render();
  };
  setInterval(quietRefresh, 60000);
  setInterval(() => { const u = document.getElementById("upd"); if (u && shownAt) { const m = Math.floor((Date.now() - shownAt) / 60000); u.textContent = (m < 1 ? "Updated just now" : "Updated " + m + " min ago") + ". Updates every minute."; } }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - shownAt > 10000) quietRefresh(); });
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") render(); });
  render();
})();
