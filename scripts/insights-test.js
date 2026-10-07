// Checks upgrade options and export comparison on a small hand-made fixture (no PAM data needed).
// Usage: node scripts/insights-test.js
import assert from "node:assert/strict";
import "../app/insights.js";

const { upgradeOptions, compareExports } = globalThis.PamInsights;
const P = (pv, product, status, eomm, extra = {}) => ({ pv, name: pv, product, line: extra.line || product, status, eomm, ua: extra.ua || null, eoem: extra.eoem || null });

const products = [
  P("NW 7.4", "NW", "In customer-specific maintenance", "2020-12-31"),
  P("NW 7.5", "NW", "Unrestricted available", "2027-12-31", { ua: "2015-10-20" }),
  P("BI 4.3", "BI", "Unrestricted available", "2026-12-31"),
  P("BI 2025", "BI", "Unrestricted available", "2027-12-31"),
  P("BI 2027", "BI", "Not yet available", "2029-12-31"),
  P("EHP7 FOR ERP", "SAP ERP ENHANCE PACKAGE", "Unrestricted available", "2027-12-31", { line: "SAP ERP", ua: "2013-08-13" }),
  P("EHP8 FOR ERP", "SAP ERP ENHANCE PACKAGE", "Unrestricted available", "2027-12-31", { line: "SAP ERP", ua: "2016-01-20" }),
  P("S/4HANA 2023", "SAP S/4HANA", "Unrestricted available", "2030-12-31"),
  P("S/4HANA 2025", "SAP S/4HANA", "Unrestricted available", "2032-12-31"),
  P("SOLMAN 7.2", "SAP SOLUTION MANAGER", "Unrestricted available", "2027-12-31"),
];
const get = (pv) => products.find((p) => p.pv === pv);

let o = upgradeOptions(get("NW 7.4"), products);
assert.equal(o.sameProduct.pv, "NW 7.5");
assert.equal(o.announced, null);

o = upgradeOptions(get("BI 4.3"), products);
assert.equal(o.sameProduct.pv, "BI 2025");
assert.equal(o.announced.pv, "BI 2027", "announced version with longer support is offered");

o = upgradeOptions(get("EHP7 FOR ERP"), products);
assert.equal(o.sameProduct, null, "same end date is not an upgrade");
assert.equal(o.strategic.product.pv, "S/4HANA 2025", "ERP points to newest S/4HANA");

o = upgradeOptions(get("SOLMAN 7.2"), products);
assert.equal(o.latest, true);
assert.match(o.strategic.text, /Cloud ALM/);

const before = [
  { ...get("NW 7.5"), eoem: null },
  { ...get("BI 2025"), eomm: "2026-12-31" },
  { ...get("EHP7 FOR ERP"), eomm: "2028-12-31" },
  { ...get("NW 7.4"), status: "Unrestricted available" },
  P("OLD PRODUCT 1.0", "OLD", "Out of maintenance", "2015-12-31"),
];
const after = [{ ...get("NW 7.5"), eoem: "2030-12-31" }, get("BI 2025"), get("EHP7 FOR ERP"), get("NW 7.4"), get("BI 2027")];
const d = compareExports(before, after);
assert.deepEqual(d.added.map((p) => p.pv), ["BI 2027"]);
assert.deepEqual(d.removed.map((p) => p.pv), ["OLD PRODUCT 1.0"]);
const kind = (pv) => d.changed.find((c) => c.p.pv === pv).changes.map((c) => c.kind).join(",");
assert.equal(kind("NW 7.5"), "published");
assert.equal(kind("BI 2025"), "extended");
assert.equal(kind("EHP7 FOR ERP"), "shortened");
assert.equal(kind("NW 7.4"), "status-worse");
assert.equal(d.counts.needsAttention, 2);

console.log("insights tests passed (upgrade options + export comparison)");
