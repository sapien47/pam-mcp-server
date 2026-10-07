// End-to-end check: starts the MCP server like an AI client would and calls every tool.
// Usage: npm test   (uses a fictional landscape, no customer data)

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: ["src/server.js"], env: process.env });
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name} failed: ${res.content[0].text}`);
  return JSON.parse(res.content[0].text);
}

const s = await call("pam_summary", {});
console.log("\npam_summary:", s.totalProductVersions, "product versions;", JSON.stringify(s.mainstreamMaintenanceEnds));

const found = await call("pam_search_products", { query: "SolMan 7.2" });
console.log("\npam_search_products 'SolMan 7.2' ->", found.results[0]?.productVersion);

const one = await call("pam_get_product", { productVersion: "SAP NETWEAVER 7.4" });
console.log("pam_get_product 'SAP NETWEAVER 7.4' ->", one.product.status, "|", one.product.risk);

const exp = await call("pam_expiring", { months: 6, limit: 3 });
console.log(`pam_expiring 6 months -> ${exp.total} product versions, first: ${exp.results.map((r) => r.productVersion).join(", ")}`);

// Fictional landscape for demos
const check = await call("pam_check_landscape", {
  systems: ["netweaver", "ECC6 ehp8", "NW 7.40", "bw4hana 2021", "Solman 7.2", "BOBJ 4.3", "S4 2023", "ECC6 ehp2", "ECC 7", "Some Legacy Tool"],
});
console.log("\npam_check_landscape:", JSON.stringify(check.riskCounts));
for (const r of check.systems) {
  const up = r.upgradeOptions?.recommended?.productVersion || r.upgradeOptions?.note || "";
  console.log(`  [${r.risk.padEnd(8)}] ${r.input.padEnd(18)} -> ${(r.productVersion || "-").padEnd(22)} (${r.match}) ${r.explanation}${up ? `  => ${up}` : ""}`);
}

console.log("\npam_upgrade_options:");
for (const product of ["NW 7.4", "BOBJ 4.3", "ECC6 ehp2", "Solman 7.2", "SAP ASE 16.0.4", "S4 2025"]) {
  const u = await call("pam_upgrade_options", { product });
  const o = u.upgradeOptions || {};
  const fmt = (x) => (x ? `${x.productVersion || x.name}${x.endOfMainstreamMaintenance ? ` (mainstream to ${x.endOfMainstreamMaintenance})` : ""}` : "-");
  console.log(`  ${product.padEnd(15)} -> recommended: ${fmt(o.recommended)} | announced: ${fmt(o.announced)} | strategic: ${fmt(o.strategicSuccessor)}${o.note ? " | " + o.note : ""}`);
}

const res = await client.callTool({ name: "pam_changes", arguments: {} });
if (res.isError) {
  console.log("\npam_changes:", res.content[0].text);
} else {
  const ch = JSON.parse(res.content[0].text);
  console.log(`\npam_changes ${ch.previousExport.date} -> ${ch.currentExport.date}:`, JSON.stringify(ch.counts));
  console.log("  newly listed:", ch.newlyListed.map((p) => p.productVersion).join(", "));
  console.log("  no longer listed:", ch.noLongerListed.map((p) => p.productVersion).join(", "));
  for (const c of ch.changed) {
    console.log(`  ${c.needsAttention ? "!" : " "} ${c.productVersion}: ${c.changes.map((x) => `${x.field} ${x.before ?? "-"} -> ${x.after ?? "-"} [${x.kind}]`).join("; ")}`);
  }
  const mine = JSON.parse((await client.callTool({ name: "pam_changes", arguments: { systems: ["ECC6 ehp2", "ASE 16.0.4", "NW 7.4"] } })).content[0].text);
  console.log("  focused on my systems:", mine.focusedOn.join(", "), "->", mine.changed.map((c) => c.productVersion).join(", "));
}

await client.close();
