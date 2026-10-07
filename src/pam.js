// Loads data/pam.json and answers questions about it. Kept separate from the MCP layer
// so the same logic can later back a web page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../app/matcher.js";
import "../app/insights.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_FILE = process.env.PAM_DATA_FILE || path.join(projectRoot, "data", "pam.json");
const PREVIOUS_FILE = process.env.PAM_PREVIOUS_FILE || path.join(path.dirname(DATA_FILE), "pam-previous.json");

let cache = null;

export function loadData() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(
      `No PAM data found at ${DATA_FILE}. Export the PAM as CSV and run: npm run convert -- "<path to csv>"`
    );
  }
  cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return cache;
}

// "Today" can be pinned via PAM_TODAY=YYYY-MM-DD, which keeps tests and demos reproducible.
export function today() {
  return process.env.PAM_TODAY || new Date().toISOString().slice(0, 10);
}

export function addMonths(isoDate, months) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function monthsBetween(fromIso, toIso) {
  const ms = new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`);
  return Math.round((ms / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10;
}

// Uppercase, keep letters and digits only, so "S/4HANA 2023" and "s4hana-2023" compare equal.
function normalize(s) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
}
function compact(s) {
  return normalize(s).replace(/[ .]/g, "");
}

// Plain-language risk assessment for one product version, relative to today.
export function assess(p, warnMonths = 12) {
  const now = today();
  const eomm = p.endOfMainstreamMaintenance;
  const eoem = p.endOfExtendedMaintenance;
  let risk;
  let explanation;

  if (p.status === "Out of maintenance") {
    risk = "critical";
    explanation = "Out of maintenance: no support from SAP any more.";
  } else if (!eomm) {
    risk = "unknown";
    explanation = "PAM publishes no end-of-mainstream-maintenance date for this product version.";
  } else if (eomm < now) {
    if (eoem && eoem >= now) {
      risk = "high";
      explanation = `Mainstream maintenance ended on ${eomm}. Extended maintenance (paid extra) runs until ${eoem}.`;
    } else {
      risk = "high";
      explanation = `Mainstream maintenance ended on ${eomm}. Current status: ${p.status}.`;
    }
  } else if (eomm <= addMonths(now, warnMonths)) {
    risk = "medium";
    explanation = `Mainstream maintenance ends on ${eomm}, in about ${monthsBetween(now, eomm)} months.`;
  } else {
    risk = "low";
    explanation = `Mainstream maintenance runs until ${eomm} (about ${monthsBetween(now, eomm)} months from now).`;
  }
  if (eomm && eomm >= now && eoem) explanation += ` Extended maintenance is offered until ${eoem}.`;
  return { risk, explanation };
}

export function toSummary(p, warnMonths) {
  return {
    productVersion: p.productVersion,
    officialName: p.officialName,
    category: p.category,
    status: p.status,
    unrestrictedAvailable: p.unrestrictedAvailable,
    endOfMainstreamMaintenance: p.endOfMainstreamMaintenance,
    endOfExtendedMaintenance: p.endOfExtendedMaintenance,
    ...assess(p, warnMonths),
    notes: p.notes.length ? p.notes : undefined,
    supportPortalUrl: p.supportPortalUrl,
  };
}

function matchesFilters(p, { category, status }) {
  if (category && !normalize(p.category).includes(normalize(category))) return false;
  if (status && !normalize(p.status).includes(normalize(status))) return false;
  return true;
}

// Matching (app/matcher.js) and insights (app/insights.js) are shared with the web app and work on
// light records {pv, name, product, line, status, ua, uaNote, eomm, eoem}; `ref` points back to the full record.
function toLight(p) {
  const uaNote = (p.notes || []).find((n) => n.startsWith("unrestrictedAvailable:"));
  return {
    pv: p.productVersion, name: p.officialName, product: p.product, line: p.productLine, status: p.status,
    ua: p.unrestrictedAvailable, uaNote: uaNote ? uaNote.split(": ")[1] : null,
    eomm: p.endOfMainstreamMaintenance, eoem: p.endOfExtendedMaintenance, ref: p,
  };
}
let index = null;
function lightIndex() {
  index ??= loadData().products.map(toLight);
  return index;
}
function rank(query, n = 8, min = 35) {
  return globalThis.PamMatcher.match(query, lightIndex(), n, min).map((x) => ({ p: x.p.ref, s: x.p._c.includes(compact(query)) ? 100 : x.s }));
}

const brief = (l) => l && {
  productVersion: l.pv,
  status: l.status,
  endOfMainstreamMaintenance: l.eomm,
  endOfExtendedMaintenance: l.eoem || undefined,
};

// "What should we move to?" in plain fields, for one full product record.
function upgradeFor(p) {
  const all = lightIndex();
  const o = globalThis.PamInsights.upgradeOptions(all.find((l) => l.ref === p), all);
  const out = {};
  if (o.sameProduct) out.recommended = { ...brief(o.sameProduct), why: "Newest released version of the same product with longer mainstream maintenance" };
  if (o.announced) out.announced = { ...brief(o.announced), why: "Announced, not yet generally available" };
  if (o.strategic?.product) out.strategicSuccessor = { ...brief(o.strategic.product), why: "SAP's strategic successor product (general direction, not a PAM link)" };
  if (o.strategic?.text) out.strategicSuccessor = { name: o.strategic.text, why: "SAP's strategic successor (general direction, not in PAM)" };
  if (o.latest) out.note = "No later version of this product is listed in PAM.";
  return out;
}

export function upgradeOptions({ product }) {
  const ranked = rank(product, 4);
  const exact = loadData().products.find((x) => compact(x.productVersion) === compact(product));
  const p = exact || (ranked[0] && ranked[0].s >= globalThis.PamMatcher.CONFIDENT && !(ranked[1] && ranked[1].s === ranked[0].s) ? ranked[0].p : null);
  if (!p) return { found: false, didYouMean: ranked.map((x) => x.p.productVersion) };
  return { found: true, current: { ...brief(toLight(p)), ...assess(p) }, upgradeOptions: upgradeFor(p) };
}

// ---------- comparing two exports ----------
function loadPrevious() {
  if (!fs.existsSync(PREVIOUS_FILE)) {
    throw new Error(
      "Only one PAM export is loaded, so there is nothing to compare yet. Convert a newer export later (the current one is kept automatically), " +
      'or load an older one with: npm run convert -- "<older export.csv>" --as-previous'
    );
  }
  return JSON.parse(fs.readFileSync(PREVIOUS_FILE, "utf8"));
}

export function changes({ systems, onlyNeedsAttention = false, limit = 100 } = {}) {
  const current = loadData();
  const previous = loadPrevious();
  const diff = globalThis.PamInsights.compareExports(previous.products.map(toLight), lightIndex());

  let focus = null;
  if (systems?.length) {
    focus = new Set(systems.map((s) => rank(s, 1)[0]).filter((x) => x && x.s >= globalThis.PamMatcher.CONFIDENT).map((x) => x.p.productVersion));
  }
  const keep = (pv) => !focus || focus.has(pv);
  const changed = diff.changed
    .filter((c) => keep(c.p.pv) && (!onlyNeedsAttention || c.attention))
    .sort((a, b) => b.attention - a.attention)
    .map((c) => ({
      productVersion: c.p.pv,
      needsAttention: c.attention,
      changes: c.changes.map((x) => ({ field: x.label, before: x.before, after: x.after, kind: x.kind })),
    }));
  return {
    previousExport: { file: previous.source, date: previous.exportDate },
    currentExport: { file: current.source, date: current.exportDate },
    counts: diff.counts,
    focusedOn: focus ? [...focus] : undefined,
    newlyListed: diff.added.filter((p) => keep(p.pv)).slice(0, limit).map(brief),
    noLongerListed: diff.removed.filter((p) => keep(p.pv)).slice(0, limit).map(brief),
    changed: changed.slice(0, limit),
    truncated: changed.length > limit || undefined,
  };
}

export function search({ query, category, status, limit = 20 }) {
  const { products } = loadData();
  let results = products.filter((p) => matchesFilters(p, { category, status }));
  if (query) {
    const allowed = new Set(results);
    results = rank(query, 500, 50).map((x) => x.p).filter((p) => allowed.has(p));
  }
  return { total: results.length, results: results.slice(0, limit).map((p) => toSummary(p)) };
}

export function getProduct(productVersion) {
  const { products } = loadData();
  const p = products.find((x) => compact(x.productVersion) === compact(productVersion));
  if (p) return { found: true, product: { ...p, ...assess(p) }, upgradeOptions: upgradeFor(p) };
  return { found: false, suggestions: search({ query: productVersion, limit: 5 }).results.map((r) => r.productVersion) };
}

export function expiring({ months = 12, category, includeAlreadyEnded = false, limit = 50 }) {
  const { products } = loadData();
  const now = today();
  const until = addMonths(now, months);
  const results = products
    .filter((p) => matchesFilters(p, { category }))
    .filter((p) => p.endOfMainstreamMaintenance)
    .filter((p) => p.endOfMainstreamMaintenance <= until && (includeAlreadyEnded || p.endOfMainstreamMaintenance >= now))
    .sort((a, b) => a.endOfMainstreamMaintenance.localeCompare(b.endOfMainstreamMaintenance));
  return {
    today: now,
    window: `${now} to ${until}`,
    total: results.length,
    results: results.slice(0, limit).map((p) => toSummary(p, months)),
  };
}

export function checkLandscape({ systems, warnMonths = 12 }) {
  const rows = systems.map((name) => {
    const ranked = rank(name, 4);
    const tie = ranked[1] && ranked[1].s === ranked[0].s;
    if (!ranked.length || ranked[0].s < globalThis.PamMatcher.CONFIDENT || tie) {
      return {
        input: name, match: "none", risk: "unknown",
        explanation: "No confident match in PAM. Ask the user which product version is meant.",
        didYouMean: ranked.length ? ranked.map((x) => x.p.productVersion) : undefined,
      };
    }
    const best = ranked[0];
    return {
      input: name,
      match: best.s === 100 ? "exact" : "fuzzy",
      matchScore: best.s,
      ...toSummary(best.p, warnMonths),
      upgradeOptions: upgradeFor(best.p),
      alternatives: best.s < 100 ? ranked.slice(1, 4).map((x) => x.p.productVersion) : undefined,
    };
  });

  const order = { critical: 0, high: 1, medium: 2, unknown: 3, low: 4 };
  rows.sort((a, b) => order[a.risk] - order[b.risk]);
  const counts = rows.reduce((acc, r) => ((acc[r.risk] = (acc[r.risk] || 0) + 1), acc), {});
  return {
    today: today(),
    warnMonths,
    riskCounts: counts,
    note: "Fuzzy or ambiguous matches should be confirmed by a person before acting on them.",
    systems: rows,
  };
}

export function summary({ category } = {}) {
  const data = loadData();
  const products = data.products.filter((p) => matchesFilters(p, { category }));
  const now = today();
  const byStatus = {};
  const byCategory = {};
  for (const p of products) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    const c = p.category || "(none)";
    byCategory[c] = (byCategory[c] || 0) + 1;
  }
  const endsWithin = (m) =>
    products.filter((p) => p.endOfMainstreamMaintenance && p.endOfMainstreamMaintenance >= now && p.endOfMainstreamMaintenance <= addMonths(now, m)).length;
  return {
    dataSource: data.source,
    exportDate: data.exportDate,
    today: now,
    totalProductVersions: products.length,
    byStatus,
    byCategory: category ? undefined : byCategory,
    mainstreamMaintenanceEnds: {
      within3Months: endsWithin(3),
      within6Months: endsWithin(6),
      within12Months: endsWithin(12),
      within24Months: endsWithin(24),
      alreadyEnded: products.filter((p) => p.endOfMainstreamMaintenance && p.endOfMainstreamMaintenance < now).length,
      noDatePublished: products.filter((p) => !p.endOfMainstreamMaintenance).length,
    },
  };
}
