// Loads data/pam.json and answers questions about it. Kept separate from the MCP layer
// so the same logic can later back a web page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../app/matcher.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_FILE = process.env.PAM_DATA_FILE || path.join(projectRoot, "data", "pam.json");

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

// Free-text matching lives in app/matcher.js, shared with the web app so both behave the same.
// It expects {pv, name, product}; the index keeps a reference back to the full record.
let index = null;
function rank(query, n = 8, min = 35) {
  const { products } = loadData();
  index ??= products.map((p) => ({ pv: p.productVersion, name: p.officialName, product: p.product, ref: p }));
  return globalThis.PamMatcher.match(query, index, n, min).map((x) => ({ p: x.p.ref, s: x.p._c.includes(compact(query)) ? 100 : x.s }));
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
  if (p) return { found: true, product: { ...p, ...assess(p) } };
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
