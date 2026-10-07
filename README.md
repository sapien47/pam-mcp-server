# SAP Support Radar: PAM web app + MCP server

**"Which of our SAP systems are running out of support?"**: answered in seconds, for people and for AI assistants, from the official SAP Product Availability Matrix (PAM).

SAP offers no public API for PAM. It does let any S-user export it as a CSV file. This project turns that export into:

1. **A web app** (deployable to SAP BTP) with a dashboard, a searchable product list and a *My landscape* risk check.
2. **An MCP server**, so an AI assistant (Claude, Joule, Copilot or any MCP client) can answer support questions with the complete data instead of guessing from the web.

**No SAP data is included or uploaded anywhere.** Everyone brings their own PAM export. The web app reads it inside the browser; the MCP server reads it from a local file.

```
                      ┌─► Web app (SAP BTP, static)  → for people: dashboard, filters, landscape check
PAM CSV export ───────┤
                      └─► MCP server (local)         → for AI: ask questions in plain language
```

## Write system names the way people do

Landscape lists are rarely written in PAM's official wording. A shared matcher (`app/matcher.js`, used by both the web app and the MCP server) understands shorthand and typos:

| You write | Matched PAM product version |
|---|---|
| `ECC6 ehp2` | EHP2 FOR SAP ERP 6.0 |
| `NW 750` · `Netwaever 7.5` | SAP NETWEAVER 7.5 |
| `Solman 7.2` | SAP SOLUTION MANAGER 7.2 |
| `BOBJ 4.3` · `Business Objects 4.3` | SBOP BI PLATFORM 4.3 |
| `S4 2023` · `bw4hana 2021` | SAP S/4HANA 2023 · SAP BW/4HANA 2021 |
| `HANA DB 2` · `R3 4.6C` | SAP HANA PLATFORM EDITION 2.0 · SAP R/3 4.6C |

It never guesses silently:
- A version number you type must appear in the product version (7.4 is never matched to 7.5).
- When candidates tie (e.g. `netweaver` without a version) or the match is weak, it asks *"did you mean…"* instead.
- Every automatic match shows what was originally typed, so a person can confirm it.

`npm test` checks 25 real-world spellings against the PAM data.

## Example: checking a (fictional) landscape

| Risk | Typed as | PAM product | Why |
|---|---|---|---|
| high | NW 7.40 | SAP NETWEAVER 7.4 | Mainstream maintenance ended 31.12.2020; customer-specific maintenance only |
| high | ECC6 ehp2 | EHP2 FOR SAP ERP 6.0 | Mainstream maintenance ended 31.12.2025 |
| medium | BOBJ 4.3 | SBOP BI PLATFORM 4.3 | Mainstream maintenance ends 31.12.2026 |
| low | ECC6 ehp8 | EHP8 FOR SAP ERP 6.0 | Mainstream until 31.12.2027, extended until 31.12.2030 |
| low | S4 2023 | SAP S/4HANA 2023 | Mainstream until 31.12.2030 |
| unknown | Some legacy tool | – | Not in PAM |

*(With "today" = 7 Oct 2026 and the PAM export of the same day.)*

**Risk levels:** *critical* = out of maintenance · *high* = mainstream maintenance already ended · *medium* = ends within the warning window (default 12 months) · *low* = later · *unknown* = no date published or no confident match.

## Get the data

Log in to the SAP Support Portal, open the Product Availability Matrix and export it as CSV (semicolon-separated, about 1,500 product versions).

## Web app

Static HTML/JavaScript, no backend, no build step. Files are in `app/`.

- **Run locally:** open `app/index.html` in a browser and drop the CSV on it.
- **Deploy to SAP BTP (Cloud Foundry):**

```bash
cd app
cf login --sso
cf push
```

`manifest.yml` uses the static-file buildpack with 64 MB memory. The page stores the uploaded data in the visitor's own browser only.

## MCP server

Requires Node.js 18 or newer.

```bash
npm install
npm run convert -- "C:\path\to\extractPAM.csv"
npm test
```

| Tool | Example question |
|---|---|
| `pam_summary` | "Give me an overview of SAP support status. How much ends in the next 6 months?" |
| `pam_search_products` | "When does support for Solman 7.2 end?" |
| `pam_get_product` | "Show me everything PAM says about SAP NETWEAVER 7.5." |
| `pam_expiring` | "Which Technology Platform products lose mainstream maintenance within 12 months?" |
| `pam_check_landscape` | "Here's our system list. Rate each system's support risk." |

**Connect to Claude Desktop:** quit Claude Desktop completely, then run `npm run add-to-claude-desktop`, then start Claude Desktop again. Or add this to `claude_desktop_config.json` yourself:

```json
{
  "mcpServers": {
    "sap-pam": {
      "command": "node",
      "args": ["C:/path/to/pam-mcp-server/src/server.js"]
    }
  }
}
```

## Limitations

- **Data is as fresh as your export.** Re-export regularly; PAM online is always the reference.
- **Product dependencies are not modelled.** For example, extended maintenance for Solution Manager comes from the ERP contract.
- **Empty dates are "unknown", never "no risk".** About 7% of product versions have no end-of-mainstream-maintenance date in PAM.
- Not affiliated with or endorsed by SAP.

## Credits

Inspired by Tobias Hofmann's *SAP Product Support Validation* app and MCP server, shared on LinkedIn.

## License

MIT
