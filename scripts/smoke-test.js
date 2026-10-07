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
  systems: ["ECC 6.0 EHP8", "SAP NetWeaver 7.4", "BW/4HANA 2021", "SolMan 7.2", "BO 4.3", "S/4HANA 2023", "Some Legacy Tool"],
});
console.log("\npam_check_landscape:", JSON.stringify(check.riskCounts));
for (const r of check.systems) {
  console.log(`  [${r.risk.padEnd(8)}] ${r.input.padEnd(18)} -> ${(r.productVersion || "-").padEnd(22)} (${r.match}) ${r.explanation}`);
}

await client.close();
