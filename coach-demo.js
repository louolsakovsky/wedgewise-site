/* DEMO TEAM for the Coaching Dashboard (Lou, Oct 22): made-up players, practice shots and rounds,
   built in the browser. Nothing touches the database. Open coach.html?demo=1 to see it.
   To remove the demo later: delete this file and the lines marked "DEMO" in coach.js. */
(function () {
  const DAY = 864e5, NOW = Date.now();
  const rng = seed => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const iso = t => new Date(t).toISOString();
  const dayStr = t => new Date(t).toISOString().slice(0, 10);
  /* Same conditions math as the app, so the demo numbers behave like real ones. */
  const factor = (t, e, c) => { const L = c / 100; return (1 + 0.008 * L * (t - 75) / 10) * (1 + 0.013 * L * e / 1000); };

  const COURSES = ["Oak Ridge Golf Club", "Lakeview Country Club", "Cedar Hills Golf Course", "Fox Run Golf Club", "Stone Creek Golf Club", "Maple Valley Country Club", "Harbor Pines Golf Club"];
  const TYPES = ["tournament", "qualifying", "practice", "casual"];
  /* name, handicap, skill (feet from the hole at 100 yd), change per month (negative = getting closer), distance (1 = average) */
  const PLAYERS = [
    ["Jake Miller", "+2.1", 22, -1.4, 1.06], ["Ryan Chen", "+1.4", 24, -0.4, 1.02], ["Tyler Brooks", "+0.8", 26, 1.3, 1.04],
    ["Ethan Walsh", "0.2", 28, -2.2, 0.98], ["Nick Romano", "0.9", 28, 0.2, 1.01], ["Owen Fischer", "1.5", 30, -0.9, 0.97],
    ["Luke Patel", "+0.5", 25, 0.9, 1.0], ["Sam Harrington", "2.3", 32, -1.8, 0.95], ["Drew Kowalski", "1.1", 29, 0.5, 1.03],
    ["Matt Lindqvist", "0.6", 27, -1.1, 0.99],
  ];
  const BASE = { LW: [44, 60, 76], SW: [55, 72, 89], GW: [66, 85, 101], PW: [77, 97, 116], "9I": [87, 108, 128] };
  const LOFT = { LW: 60, SW: 56, GW: 52, PW: 46, "9I": 41 };

  function player([name, hcp, skill, perMonth, dist], i) {
    const r = rng(1000 + i * 77);
    const clubNames = i % 3 === 0 ? ["LW", "SW", "GW", "PW"] : ["LW", "SW", "GW", "PW", "9I"];
    const clubs = clubNames.map(n => ({ id: n, name: n, loft: LOFT[n] + (r() < 0.3 ? (r() < 0.5 ? -2 : 2) : 0) }));
    const ks = ["half", "tq", "full"];
    /* Practice shots: 1 to 12 per number, over the last 3 months, in all kinds of weather. */
    const shots = [];
    clubs.forEach(c => ks.forEach((k, j) => {
      const n = Math.floor(r() * r() * 12) + 1;
      const std0 = BASE[c.name][j] * dist;
      for (let s = 0; s < n; s++) {
        const t = 45 + Math.round(r() * 45), e = Math.round(r() * 1200), std = std0 + (r() - 0.5) * 6;
        shots.push({ id: "d" + i + c.id + k + s, clubId: c.id, swing: k, source: r() < 0.5 ? "launch_monitor" : "manual",
          carry: Math.round(std * factor(t, e, std) * 10) / 10, tempF: t, elevFt: e, date: iso(NOW - Math.floor(r() * 90) * DAY - Math.floor(r() * 8) * 36e5) });
      }
    }));
    /* Rounds: about every 9 days since early summer, 12 to 16 approach shots each. */
    const rounds = [];
    let t = NOW - 115 * DAY + Math.floor(r() * 6) * DAY, ri = 0;
    while (t < NOW - DAY) {
      const months = (t - (NOW - 115 * DAY)) / (30 * DAY);
      const sk = Math.max(9, skill + perMonth * months);
      const list = [];
      const nShots = 12 + Math.floor(r() * 5);
      for (let s = 0; s < nShots; s++) {
        const yd = Math.round(35 + Math.pow(r(), 0.8) * 150);
        const lr = r(), lie = lr < 0.64 ? "fairway" : lr < 0.93 ? "rough" : "bunker";
        const mult = lie === "rough" ? 1.35 : lie === "bunker" ? 1.75 : 1;
        let ft = sk * Math.pow(yd / 100, 1.1) * mult * (0.35 + r() * 1.3);
        ft = yd < 80 && r() < 0.015 ? 0 : Math.max(1, Math.round(ft));
        const finish = ft <= 28 ? (r() < 0.9 ? "green" : "fringe") : ft <= 42 ? (r() < 0.55 ? "fringe" : "green") : r() < 0.75 ? "rough" : "bunker";
        list.push({ id: "a" + i + "-" + ri + "-" + s, yd, lie, finish, ft, at: iso(t) });
      }
      rounds.push({ id: "r" + i + "-" + ri, day: dayStr(t), course: { name: COURSES[Math.floor(r() * COURSES.length)] }, type: TYPES[Math.floor(r() * TYPES.length)], holes: 18, wind: r() < 0.6 ? "calm" : "breezy", shots: list });
      t += (7 + Math.floor(r() * 6)) * DAY; ri++;
    }
    return {
      user_id: "demo-" + i, name, role: "player", joined_at: iso(NOW - (60 + i * 3) * DAY),
      state: { v: 1, profile: { name, handicap: hcp, level: "College" }, system: "fraction", units: { dist: "yd", temp: "F", elev: "ft" }, clubs, shots, rounds },
    };
  }

  /* A made-up school crest so the demo shows team branding (Lou, Oct 22). */
  const DEMO_LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgMTQwIj48cGF0aCBkPSJNNjAgNCAxMTIgMjJ2NDRjMCAzNC0yMiA1OC01MiA3MEMzMCAxMjQgOCAxMDAgOCA2NlYyMnoiIGZpbGw9IiM3QTFGMkIiLz48cGF0aCBkPSJNNjAgMTQgMTAyIDI5djM3YzAgMjgtMTggNDgtNDIgNTktMjQtMTEtNDItMzEtNDItNTlWMjl6IiBmaWxsPSJub25lIiBzdHJva2U9IiNDOUE0NEMiIHN0cm9rZS13aWR0aD0iNCIvPjx0ZXh0IHg9IjYwIiB5PSI4NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsc2VyaWYiIGZvbnQtd2VpZ2h0PSI3MDAiIGZvbnQtc2l6ZT0iNDQiIGZpbGw9IiNmZmYiPkRVPC90ZXh0PjxwYXRoIGQ9Ik0zNCAxMDBoNTIiIHN0cm9rZT0iI0M5QTQ0QyIgc3Ryb2tlLXdpZHRoPSI0Ii8+PC9zdmc+";
  const roster = PLAYERS.map(player);
  roster.push({ user_id: "demo-coach", name: "Coach Taylor", role: "coach", joined_at: iso(NOW - 70 * DAY), state: null });

  window.WEDGELAB_DEMO = {
    session: { user: { email: "demo@wedgelab.app" } },
    team: { id: "demo", gender: "men", logo: DEMO_LOGO, name: "Demo University Golf", school: "Demo University", code: "DEMO12", coach_code: "COACH7", seats: 12, status: "active",
      paid_until: dayStr(NOW + 300 * DAY), stripe_subscription: "demo" },
    roster,
    invites: [
      { email: "jake.miller@demo.edu", created_at: iso(NOW - 62 * DAY), sent_at: iso(NOW - 62 * DAY) },
      { email: "new.recruit@demo.edu", created_at: iso(NOW - 2 * DAY), sent_at: iso(NOW - 2 * DAY) },
    ],
  };
})();
