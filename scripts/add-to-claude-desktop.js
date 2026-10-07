// Registers this MCP server in Claude Desktop's config (claude_desktop_config.json).
// Run it while Claude Desktop is fully closed: the app rewrites the file from memory and would drop the entry.
//
// Usage: npm run add-to-claude-desktop

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverJs = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.js")
  .replace(/\\/g, "/");

const configFile =
  process.platform === "win32"
    ? path.join(process.env.APPDATA, "Claude", "claude_desktop_config.json")
    : path.join(process.env.HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json");

if (process.platform === "win32") {
  const running = execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH', { encoding: "utf8" });
  if (/claude\.exe/i.test(running)) {
    console.error("Claude Desktop is still running. Quit it from the taskbar tray (right-click > Quit), then run this again.");
    process.exit(1);
  }
}

const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
if (fs.existsSync(configFile)) fs.copyFileSync(configFile, `${configFile}.bak`);

config.mcpServers = config.mcpServers || {};
config.mcpServers["sap-pam"] = { command: process.execPath, args: [serverJs] };
fs.mkdirSync(path.dirname(configFile), { recursive: true });
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

console.log(`Added "sap-pam" to ${configFile}`);
console.log(`  command: ${process.execPath}`);
console.log(`  server:  ${serverJs}`);
console.log("Now start Claude Desktop. Look for sap-pam under + > Connectors.");
