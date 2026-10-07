// Insights on top of PAM data, shared by the web app (script tag) and the MCP server (import):
//  - upgradeOptions: "what should we move to?" for a product version
//  - compareExports: "what changed between two PAM exports?"
// Both work on light records: { pv, name, product, line, status, ua, uaNote, eomm, eoem } with ISO dates.
(function (g) {
  const RELEASED = (s) => s === "Unrestricted available" || /productive use allowed/.test(s || "");

  // Successor products PAM does not link itself. Kept short and labelled as general SAP direction.
  const STRATEGIC = [
    { when: (p) => p.line === "SAP ERP" || /^SAP (ERP|ECC)\b/.test(p.product || ""), product: "SAP S/4HANA" },
    { when: (p) => p.product === "SAP BW", product: "SAP BW/4HANA" },
    { when: (p) => p.product === "SAP SOLUTION MANAGER", text: "SAP Cloud ALM (cloud service, not listed in PAM)" },
  ];

  const newest = (list) => list.slice().sort((a, b) => b.eomm.localeCompare(a.eomm) || (b.ua || "").localeCompare(a.ua || ""))[0] || null;

  // Best released version of the same product with a later end of mainstream maintenance,
  // the next announced one (if it runs even longer), and SAP's strategic successor product where known.
  function upgradeOptions(p, products) {
    const later = products.filter((x) => x !== p && x.product === p.product && x.eomm && (!p.eomm || x.eomm > p.eomm));
    const best = newest(later.filter((x) => RELEASED(x.status)));
    const planned = newest(later.filter((x) => x.status === "Not yet available"));
    const result = {
      sameProduct: best,
      announced: planned && (!best || planned.eomm > best.eomm) ? planned : null,
      strategic: null,
      latest: !best && !planned,
    };
    const rule = STRATEGIC.find((r) => r.when(p));
    if (rule && rule.product) {
      const s = newest(products.filter((x) => x.product === rule.product && x.eomm && RELEASED(x.status)));
      if (s) result.strategic = { product: s };
    } else if (rule) {
      result.strategic = { text: rule.text };
    }
    return result;
  }

  // ---------- export comparison ----------
  const FIELDS = [
    ["status", "Status"],
    ["ua", "Unrestricted availability"],
    ["eomm", "End of mainstream maintenance"],
    ["eoem", "End of extended maintenance"],
  ];
  const WORSE_STATUS = new Set(["Out of maintenance", "In customer-specific maintenance", "In extended maintenance"]);
  const value = (p, f) => p[f] || (f === "ua" ? p.uaNote : null) || null;

  function kindOf(f, before, after) {
    if (f === "status") return WORSE_STATUS.has(after) && !WORSE_STATUS.has(before) ? "status-worse" : "status";
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
    if (!before) return "published";
    if (!after) return f === "ua" ? "changed" : "removed";
    if (!isDate(before) || !isDate(after)) return "changed";
    if (f === "ua") return after < before ? "earlier" : "later";
    return after > before ? "extended" : "shortened";
  }
  // Changes someone responsible for a landscape should look at first.
  const ATTENTION = new Set(["shortened", "removed", "status-worse"]);

  function compareExports(oldList, newList) {
    const before = new Map(oldList.map((p) => [p.pv, p]));
    const after = new Map(newList.map((p) => [p.pv, p]));
    const added = [], removed = [], changed = [];
    for (const [pv, p] of after) {
      const q = before.get(pv);
      if (!q) { added.push(p); continue; }
      const changes = FIELDS
        .filter(([f]) => value(q, f) !== value(p, f))
        .map(([f, label]) => ({ field: f, label, before: value(q, f), after: value(p, f), kind: kindOf(f, value(q, f), value(p, f)) }));
      if (changes.length) changed.push({ p, changes, attention: changes.some((c) => ATTENTION.has(c.kind)) });
    }
    for (const [pv, q] of before) if (!after.has(pv)) removed.push(q);

    const count = (k) => changed.filter((c) => c.changes.some((x) => x.kind === k)).length;
    return {
      added, removed, changed,
      counts: {
        added: added.length,
        removed: removed.length,
        changed: changed.length,
        extended: count("extended"),
        shortened: count("shortened"),
        statusChanges: changed.filter((c) => c.changes.some((x) => x.field === "status")).length,
        needsAttention: changed.filter((c) => c.attention).length,
      },
    };
  }

  g.PamInsights = { upgradeOptions, compareExports, ATTENTION };
})(typeof window !== "undefined" ? window : globalThis);
