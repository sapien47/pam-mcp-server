// Bundles a PAM export with the web app, so users without an S-user see data without uploading anything.
//
// Usage:  npm run publish-data -- "C:\path\to\extractPAM.csv"
//         then:  cd app  &&  cf push
//
// The export currently bundled is kept as app/data/pam-previous.csv, so the "What changed" tab
// shows what SAP changed between the two exports. app/data/ is git-ignored: PAM data never goes to GitHub.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "data");
const current = path.join(dataDir, "pam.csv");
const previous = path.join(dataDir, "pam-previous.csv");
const metaFile = path.join(dataDir, "pam-meta.json");

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run publish-data -- "C:\\path\\to\\extractPAM.csv"');
  process.exit(1);
}
const text = fs.readFileSync(src, "utf8");
if (!/^\uFEFF?"?Product Version"?;/.test(text)) {
  console.error("This does not look like a PAM CSV export (first column should be 'Product Version').");
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};
const date = fs.statSync(src).mtime.toISOString().slice(0, 10);

if (fs.existsSync(current) && fs.readFileSync(current, "utf8") !== text) {
  fs.renameSync(current, previous);
  meta.previous = meta.current;
  console.log(`Kept the earlier export (${meta.previous?.date}) as app/data/pam-previous.csv for "What changed"`);
}
fs.writeFileSync(current, text);
meta.current = { file: path.basename(src), date };
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

const rows = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
console.log(`Bundled ${rows} product versions (export of ${date}) into app/data/. Now deploy: cd app && cf push`);
