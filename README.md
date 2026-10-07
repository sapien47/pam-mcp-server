# PAM MCP Server

Ask an AI assistant **"which of our SAP systems are running out of support?"** and get a plain-language answer, based on the official SAP Product Availability Matrix (PAM).

SAP offers no public API for PAM. It does let any S-user export it as a CSV file. This project:

1. **Converts** that export into a clean local data file.
2. **Serves** it to AI assistants (Claude, Joule, Copilot or any other MCP client) through an MCP server with five tools.

The PAM data never leaves your machine and is never committed to Git: you bring your own export.

## What the AI can do with it

| Tool | Example question |
|---|---|
| `pam_summary` | "Give me an overview of SAP support status. How much ends in the next 6 months?" |
| `pam_search_products` | "When does support for SolMan 7.2 end?" (understands shorthand like *ECC EHP8*, *BO 4.3*, *SolMan*) |
| `pam_get_product` | "Show me everything PAM says about SAP NETWEAVER 7.5." |
| `pam_expiring` | "Which Technology Platform products lose mainstream maintenance within 12 months?" |
| `pam_check_landscape` | "Here's our system list. Rate each system's support risk." |

### Example: checking a (fictional) landscape

| Risk | System as written | Matched PAM product | Why |
|---|---|---|---|
| high | SAP NetWeaver 7.4 | SAP NETWEAVER 7.4 | Mainstream maintenance ended 31.12.2020; now in customer-specific maintenance |
| medium | BO 4.3 | SBOP BI PLATFORM 4.3 | Mainstream maintenance ends 31.12.2026 |
| low | ECC 6.0 EHP8 | EHP8 FOR SAP ERP 6.0 | Mainstream until 31.12.2027, extended until 31.12.2030 |
| low | BW/4HANA 2021 | SAP BW/4HANA 2021 | Mainstream until 31.12.2027 |
| unknown | Some Legacy Tool | – | Not found in PAM |

*(Result with "today" set to 7 Oct 2026 and the PAM export of the same day.)*

**Risk levels:** *critical* = out of maintenance · *high* = mainstream maintenance already ended · *medium* = ends within the warning window (default 12 months) · *low* = later · *unknown* = no date published or no match.

## Setup

Requires Node.js 18 or newer.

```bash
npm install
```

1. Log in to the SAP Support Portal, open the Product Availability Matrix and export it as CSV.
2. Convert the export:

```bash
npm run convert -- "C:\path\to\extractPAM.csv"
```

3. Check that everything works:

```bash
npm test
```

### Connect it to Claude Desktop / Claude Code

Add this to your MCP client configuration (adjust the path):

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

- **Data is as fresh as your export.** Re-export and re-convert regularly; PAM online is always the reference.
- **Name matching is fuzzy.** Results marked `fuzzy` or `ambiguous` should be confirmed by a person.
- **Product dependencies are not modelled.** For example, extended maintenance for Solution Manager comes from the ERP contract.
- **Empty dates are shown as "unknown", never as "no risk".** About 7% of product versions have no end-of-mainstream-maintenance date in PAM.
- Not affiliated with or endorsed by SAP.

## Credits

Inspired by Tobias Hofmann's *SAP Product Support Validation* app and MCP server.
