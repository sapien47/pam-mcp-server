// Loads data/pam.json and answers questions about it. Kept separate from the MCP layer
// so the same logic can later back a web page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
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

// Scores how well a free-text name (e.g. "ECC 6.0 EHP8") matches a product version.
function score(query, p) {
  const q = compact(query);
  const names = [p.productVersion, p.officialName];
  if (names.some((n) => compact(n) === q)) return 100;
  const qTokens = tokens(query);
  if (!qTokens.length) return 0;
  const target = tokens(`${p.productVersion} ${p.officialName} ${p.product}`);
  const hits = qTokens.filter((t) => target.includes(t)).length;
  let s = (hits / qTokens.length) * 80;
  if (names.some((n) => compact(n).includes(q))) s = Math.max(s, 70);
  // Tie-breaker: prefer product versions without extra words ("BW/4HANA 2021" over "BPC 2021, FOR BW/4HANA").
  const pvTokens = tokens(p.productVersion).filter((t) => t !== "SAP");
  const covered = pvTokens.filter((t) => qTokens.includes(t)).length;
  s += pvTokens.length ? (covered / pvTokens.length) * 19 : 0;
  return Math.min(99, Math.round(s));
}

// Common landscape shorthand → PAM wording. Kept small and explicit, so matches stay explainable.
const ALIASES = [
  [/\bECC\b/g, "ERP"],
  [/\bEHP\s?(\d)\b/g, "EHP$1"],
  [/\bNW\b/g, "NETWEAVER"],
  [/\bSOLMAN\b/g, "SOLUTION MANAGER"],
  [/\bBOBJ\b|\bBO\b/g, "SBOP BI PLATFORM"],
  [/\bS4\b|\bS 4\b/g, "S/4HANA"],
];
function expandAliases(q) {
  let out = normalize(q);
  for (const [re, rep] of ALIASES) out = out.replace(re, rep);
  return out;
}

export function search({ query, category, status, limit = 20 }) {
  const { products } = loadData();
  let results = products.filter((p) => matchesFilters(p, { category, status }));
  if (query) {
    const q = expandAliases(query);
    results = results
      .map((p) => ({ p, s: Math.max(score(query, p), score(q, p)) }))
      .filter((x) => x.s >= 50)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
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
  const { products } = loadData();
  const rows = systems.map((name) => {
    const q = expandAliases(name);
    // An exact hit only via an alias ("BO 4.3" -> "SBOP BI PLATFORM 4.3") counts as a strong fuzzy match, not exact.
    const ranked = products
      .map((p) => ({ p, s: Math.max(score(name, p), Math.min(99, score(q, p))) }))
      .filter((x) => x.s >= 50)
      .sort((a, b) => b.s - a.s);
    if (!ranked.length) {
      return { input: name, match: "none", risk: "unknown", explanation: "No matching product version found in PAM." };
    }
    const best = ranked[0];
    const tied = ranked.filter((x) => x.s === best.s);
    return {
      input: name,
      match: best.s === 100 ? "exact" : tied.length > 1 ? "ambiguous" : "fuzzy",
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
