// Checks the matcher against how people really write SAP products. Usage: node scripts/match-test.js
import fs from "node:fs";
import "../app/matcher.js";

const data = JSON.parse(fs.readFileSync(new URL("../data/pam.json", import.meta.url), "utf8"));
const products = data.products.map((p) => ({ pv: p.productVersion, name: p.officialName, product: p.product }));

const CASES = {
  "ECC6 ehp2": "EHP2 FOR SAP ERP 6.0",
  "ECC 6.0 EHP8": "EHP8 FOR SAP ERP 6.0",
  "sap ecc6.0 ehp 7": "EHP7 FOR SAP ERP 6.0",
  "ERP 6 enhancement package 6": "EHP6 FOR SAP ERP 6.0",
  "ECC 6.0": "SAP ERP 6.0",
  "NW 750": "SAP NETWEAVER 7.5",
  "netweaver 7.40": "SAP NETWEAVER 7.4",
  "Netweaver7.5": "SAP NETWEAVER 7.5",
  "Solman 7.2": "SAP SOLUTION MANAGER 7.2",
  "solution manager 7.2": "SAP SOLUTION MANAGER 7.2",
  "BOBJ 4.3": "SBOP BI PLATFORM 4.3",
  "Business Objects 4.3": "SBOP BI PLATFORM 4.3",
  "BO 4.2": "SBOP BI PLATFORM 4.2",
  "S4 2023": "SAP S/4HANA 2023",
  "s/4 hana 2022": "SAP S/4HANA 2022",
  "S4HANA 2021": "SAP S/4HANA 2021",
  "BW4HANA 2021": "SAP BW/4HANA 2021",
  "bw/4 2023": "SAP BW/4HANA 2023",
  "HANA 2.0": "SAP HANA PLATFORM EDITION 2.0",
  "hana db 2": "SAP HANA PLATFORM EDITION 2.0",
  "R3 4.6C": "SAP R/3 4.6C",
  "CRM 7.0": "SAP CRM 7.0",
  "SCM 7 EHP4": "EHP4 FOR SAP SCM 7.0",
  "SRM 7.0 ehp3": "EHP3 FOR SAP SRM 7.0",
  "Netwaever 7.5": "SAP NETWEAVER 7.5",
};

let ok = 0;
for (const [input, expected] of Object.entries(CASES)) {
  const [best, second] = globalThis.PamMatcher.match(input, products, 2);
  const pass = best && best.p.pv === expected && best.s >= globalThis.PamMatcher.CONFIDENT;
  ok += pass;
  console.log(`${pass ? "PASS" : "FAIL"}  ${input.padEnd(30)} -> ${(best?.p.pv ?? "-").padEnd(28)} ${best?.s ?? ""}` +
    (pass ? "" : `   expected ${expected}; 2nd: ${second?.p.pv} ${second?.s}`));
}
console.log(`\n${ok}/${Object.keys(CASES).length} passed`);
process.exit(ok === Object.keys(CASES).length ? 0 : 1);
