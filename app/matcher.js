// Forgiving matcher: turns the way people write SAP products ("ECC6 ehp2", "NW 750", "Solman 7.2",
// "BOBJ 4.3", "S4 2023") into PAM product versions. Shared by the web app (script tag) and the MCP server (import).
(function (g) {
  // Applied in order to the upper-cased input. Each rule rewrites shorthand into PAM wording.
  const RULES = [
    [/\b([A-Z]{2,})(\d+(?:\.\d+)?)\b/g, "$1 $2"],                                    // ECC6 -> ECC 6, NW75 -> NW 75
    [/\bS\s*\/?\s*4\s*\/?\s*(?:HANA)?\b/g, " S/4HANA "],                               // S4, S/4, S4 HANA
    [/\bBW\s*\/?\s*4\s*\/?\s*(?:HANA)?\b/g, " BW/4HANA "],                             // BW4, BW/4HANA
    [/\bR\s*\/?\s*3\b/g, " R/3 "],
    [/\bECC\s*(\d)(?:\.0)?\b/g, " ERP $1.0 "],                                         // ECC 6 -> ERP 6.0
    [/\bECC\b/g, " ERP "],
    [/\b(?:EHP|ENHANCEMENT\s*PACK(?:AGE)?)\s*(\d)\b/g, " EHP$1 "],                     // EHP 2, enhancement package 2
    [/\b(?:NW|NETWEAVER)\s*(\d)\.?(\d{1,2})\b/g, " NETWEAVER $1.$2 "],                 // NW 750, NW7.5
    [/\bNW\b/g, " NETWEAVER "],
    [/\bSOL\s*MAN(?:AGER)?\b/g, " SOLUTION MANAGER "],
    [/\bBUSINESS\s*OBJECTS\b|\bBOBJ\b|\bBOBI\b|\bBOE\b|\bBO\b/g, " SBOP BI PLATFORM "],
    [/\bHANA\s*(?:DB|DATABASE)?\s*2(?:\.0)?\b/g, " HANA PLATFORM EDITION 2.0 "],
    [/\bPI\b/g, " PROCESS INTEGRATION "],
  ];
  const STOP = new Set(["SAP", "FOR", "ON", "THE", "AND", "OF", "VERSION", "SYSTEM", "SERVER"]);

  function rewrite(s) {
    let out = ` ${String(s || "").toUpperCase()} `;
    for (const [re, rep] of RULES) out = out.replace(re, rep);
    return out;
  }
  // "6.0" -> "6", "7.50" -> "7.5", so versions match however they are written.
  function normTok(t) {
    return /^\d+\.\d+$/.test(t) ? String(parseFloat(t)) : t;
  }
  function tokens(s, keepStop) {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9./]+/g, " ").replace(/\//g, " / ")
      .split(" ").map((t) => t.replace(/^\.+|\.+$/g, "")).filter((t) => t && t !== "/" && (keepStop || !STOP.has(t))).map(normTok);
  }
  const compact = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  // True if a and b differ by one typo: one letter added, missing, wrong, or two neighbours swapped.
  function lev1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) {
      const d = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
      if (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]) return true;
    }
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  // Numbers must match exactly (7.4 is not 7.5); words tolerate a typo or an abbreviation.
  function tokHit(q, t) {
    if (q === t) return true;
    if (/\d/.test(q) || /\d/.test(t)) return false;
    if (q.length >= 3 && t.startsWith(q)) return true;
    return q.length >= 5 && lev1(q, t);
  }

  function prepare(products) {
    for (const p of products) {
      if (p._tok) continue;
      p._tok = tokens(`${p.pv} ${p.name} ${p.product}`);
      p._pvTok = tokens(p.pv);
      p._c = [compact(p.pv), compact(p.name)];
    }
  }

  function score(query, p) {
    const raw = compact(query);
    if (raw && p._c.includes(raw)) return 100;
    const q = tokens(rewrite(query));
    if (!q.length) return 0;
    if (p._c.includes(q.join(""))) return 99;
    const hits = q.filter((x) => p._tok.some((t) => tokHit(x, t))).length;
    const covered = p._pvTok.filter((t) => q.some((x) => tokHit(x, t))).length;
    // A version number in the query that the product version itself does not carry is a strong "no".
    const nums = q.filter((x) => /\d/.test(x));
    const numMiss = nums.filter((x) => !p._pvTok.includes(x)).length;
    let s = (hits / q.length) * 80 + (p._pvTok.length ? (covered / p._pvTok.length) * 19 : 0);
    if (numMiss) s -= 25 * numMiss;
    // If the query covers less than half of the product version's name, offer it only as a suggestion.
    if (p._pvTok.length && covered / p._pvTok.length < 0.5) s = Math.min(s, 55);
    return Math.max(0, Math.min(99, Math.round(s)));
  }

  // Returns ranked candidates [{p, s}]. s >= 60: confident match; 35-59: "did you mean".
  function match(query, products, n = 8, min = 35) {
    prepare(products);
    return products.map((p) => ({ p, s: score(query, p) })).filter((x) => x.s >= min)
      .sort((a, b) => b.s - a.s || a.p.pv.length - b.p.pv.length).slice(0, n);
  }

  // One decision for both UIs: a confident, unique match, or a short list for the person to pick from.
  // A tie at the top (e.g. "netweaver" without a version) is never decided automatically.
  function resolve(query, products) {
    const c = match(query, products, 4);
    const sure = c[0] && c[0].s >= CONFIDENT && !(c[1] && c[1].s === c[0].s);
    return sure ? { match: c[0], candidates: c } : { match: null, candidates: c.slice(0, 3) };
  }

  const CONFIDENT = 60;
  g.PamMatcher = { match, resolve, score, rewrite, tokens, CONFIDENT };
})(typeof window !== "undefined" ? window : globalThis);
