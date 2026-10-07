// Converts the CSV export of the SAP Product Availability Matrix (PAM) into data/pam.json.
//
// Usage:  npm run convert -- "C:\path\to\extractPAM.csv"
//         npm run convert -- "C:\path\to\older-export.csv" --as-previous
//
// Converting a newer export keeps the current data as data/pam-previous.json, so the
// pam_changes tool can report what SAP changed between the two exports.
//
// The export is semicolon-separated, every field in double quotes, dates as DD.MM.YYYY.
// The output file stays local (data/ is git-ignored): PAM data comes from behind an S-user login.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const currentFile = path.join(projectRoot, "data", "pam.json");
const previousFile = path.join(projectRoot, "data", "pam-previous.json");

// Maps CSV column headers to short JSON field names. The URL header is long, so it is matched by prefix.
const COLUMNS = {
  "Product Version": "productVersion",
  "Official Name": "officialName",
  "Product": "product",
  "Product Line": "productLine",
  "Product Category": "category",
  "Add-On Product Version": "isAddOn",
  "Current Status": "status",
  "Restricted available (productive use not allowed)": "restrictedNotProductive",
  "Restricted available (productive use allowed)": "restrictedProductive",
  "Unrestricted available": "unrestrictedAvailable",
  "Readiness Status for SAP HANA": "hanaReadiness",
  "Readiness Date for SAP HANA": "hanaReadinessDate",
  "End of mainstream maintenance": "endOfMainstreamMaintenance",
  "End of extended maintenance": "endOfExtendedMaintenance",
  "End of Priority-One Support": "endOfPriorityOneSupport",
  "End of SAP S/4HANA Cloud Safekeeper Service": "endOfSafekeeperService",
  "URL to Product Version in SAP Support Portal": "supportPortalUrl",
};

const DATE_FIELDS = [
  "restrictedNotProductive",
  "restrictedProductive",
  "unrestrictedAvailable",
  "hanaReadinessDate",
  "endOfMainstreamMaintenance",
  "endOfExtendedMaintenance",
  "endOfPriorityOneSupport",
  "endOfSafekeeperService",
];

// Minimal parser for one CSV line: ";" separator, optional double quotes, "" as an escaped quote.
function parseLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ";") { fields.push(current); current = ""; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

// "31.12.2027" -> "2027-12-31". Anything else (e.g. "Estimated for Q1/2027") is returned as a note.
function parseDate(value) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (m) return { date: `${m[3]}-${m[2]}-${m[1]}` };
  return { date: null, note: value };
}

function convert(csvFile, asPrevious) {
  const text = fs.readFileSync(csvFile, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = parseLine(lines[0]);

  const fieldNames = header.map((h) => {
    const key = Object.keys(COLUMNS).find((c) => h === c || (c.startsWith("URL") && h.startsWith(c)));
    return key ? COLUMNS[key] : null;
  });
  const missing = Object.values(COLUMNS).filter((f) => !fieldNames.includes(f));
  if (missing.length) {
    throw new Error(`The CSV is missing expected columns: ${missing.join(", ")}. Was it exported from PAM?`);
  }

  const products = [];
  const warnings = [];
  for (const line of lines.slice(1)) {
    const values = parseLine(line);
    const raw = {};
    fieldNames.forEach((name, i) => { if (name) raw[name] = (values[i] ?? "").trim(); });

    const product = {
      productVersion: raw.productVersion,
      officialName: raw.officialName || raw.productVersion,
      product: raw.product,
      productLine: raw.productLine,
      category: raw.category || null,
      isAddOn: raw.isAddOn === "Yes",
      // The export contains a double space in "Restricted available  (productive use allowed)".
      status: raw.status.replace(/\s+/g, " "),
      hanaReadiness: raw.hanaReadiness || null,
      supportPortalUrl: raw.supportPortalUrl || null,
      notes: [],
    };
    for (const f of DATE_FIELDS) {
      if (!raw[f]) { product[f] = null; continue; }
      const { date, note } = parseDate(raw[f]);
      product[f] = date;
      if (note) {
        product.notes.push(`${f}: ${note}`);
        warnings.push(`${raw.productVersion} – ${f}: "${note}"`);
      }
    }
    products.push(product);
  }

  const output = {
    source: path.basename(csvFile),
    convertedAt: new Date().toISOString(),
    exportDate: fs.statSync(csvFile).mtime.toISOString().slice(0, 10),
    count: products.length,
    products,
  };
  const outFile = asPrevious ? previousFile : currentFile;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (!asPrevious && fs.existsSync(currentFile)) {
    const existing = JSON.parse(fs.readFileSync(currentFile, "utf8"));
    if (JSON.stringify(existing.products) !== JSON.stringify(products)) {
      fs.renameSync(currentFile, previousFile);
      console.log(`Kept the earlier export (${existing.source}, ${existing.exportDate}) as ${path.relative(projectRoot, previousFile)} for comparison`);
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log(`Converted ${products.length} product versions -> ${path.relative(projectRoot, outFile)}`);
  if (warnings.length) {
    console.log(`${warnings.length} values were not plain dates (e.g. "Estimated for Q1/2027") and were kept as notes, e.g.:`);
    warnings.slice(0, 5).forEach((w) => console.log(`  - ${w}`));
  }
}

const args = process.argv.slice(2);
const csvFile = args.find((a) => !a.startsWith("--"));
if (!csvFile) {
  console.error('Usage: npm run convert -- "C:\\path\\to\\extractPAM.csv" [--as-previous]');
  process.exit(1);
}
convert(csvFile, args.includes("--as-previous"));
