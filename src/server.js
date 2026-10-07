#!/usr/bin/env node
// MCP server exposing the SAP Product Availability Matrix (PAM) export to an AI assistant.
// Runs locally over stdio; reads data/pam.json produced by `npm run convert`.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search, getProduct, expiring, checkLandscape, summary } from "./pam.js";

const server = new McpServer({ name: "pam-mcp-server", version: "0.1.0" });

// Every tool returns JSON text; errors (e.g. missing data file) come back as readable messages.
function respond(fn) {
  return async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(fn(args), null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  };
}

server.registerTool(
  "pam_summary",
  {
    title: "PAM overview",
    description:
      "Overview of the SAP Product Availability Matrix data: export date, number of product versions, counts by support status and category, and how many reach end of mainstream maintenance in 3/6/12/24 months.",
    inputSchema: {
      category: z.string().optional().describe("Optional product category filter, e.g. 'Technology Platform'"),
    },
  },
  respond(summary)
);

server.registerTool(
  "pam_search_products",
  {
    title: "Search SAP products",
    description:
      "Search SAP product versions in PAM by name (tolerant of shorthand like 'ECC EHP8', 'SolMan 7.2', 'BO 4.3'). Returns support dates, status and a risk assessment.",
    inputSchema: {
      query: z.string().optional().describe("Product name or part of it"),
      category: z.string().optional().describe("Product category filter"),
      status: z.string().optional().describe("Status filter, e.g. 'Out of maintenance', 'customer-specific'"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
    },
  },
  respond(search)
);

server.registerTool(
  "pam_get_product",
  {
    title: "Get one product version",
    description:
      "Full PAM record for one product version (exact name as in PAM, e.g. 'SAP NETWEAVER 7.5'), including all availability and maintenance dates and the Support Portal link. Suggests close names if not found.",
    inputSchema: {
      productVersion: z.string().describe("Product version name as in PAM"),
    },
  },
  respond(({ productVersion }) => getProduct(productVersion))
);

server.registerTool(
  "pam_expiring",
  {
    title: "Products running out of support",
    description:
      "List SAP product versions whose end of mainstream maintenance falls within the next N months, soonest first.",
    inputSchema: {
      months: z.number().int().min(1).max(120).optional().describe("Look-ahead window in months (default 12)"),
      category: z.string().optional().describe("Product category filter"),
      includeAlreadyEnded: z.boolean().optional().describe("Also include products whose mainstream maintenance already ended"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (default 50)"),
    },
  },
  respond(expiring)
);

server.registerTool(
  "pam_check_landscape",
  {
    title: "Check a system landscape",
    description:
      "Check a list of SAP systems/components (free text, e.g. from a design document or system list) against PAM. Matches each to a product version and rates support risk: critical, high, medium, low or unknown. Fuzzy matches should be confirmed by a person.",
    inputSchema: {
      systems: z.array(z.string()).min(1).max(200).describe("System or product names, e.g. ['ECC 6.0 EHP8', 'SAP NetWeaver 7.4', 'BW/4HANA 2021']"),
      warnMonths: z.number().int().min(1).max(60).optional().describe("Flag as medium risk if mainstream maintenance ends within this many months (default 12)"),
    },
  },
  respond(checkLandscape)
);

await server.connect(new StdioServerTransport());
