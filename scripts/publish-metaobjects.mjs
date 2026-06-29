/**
 * Publishes all pdp_app_settings and pdp_icon metaobject instances to ACTIVE
 * so they are accessible in Shopify Liquid (shop.metaobjects.*).
 *
 * Usage: node scripts/publish-metaobjects.mjs
 * Requires: SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN in .env.local
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env.local manually (no dotenv dependency needed)
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env.local");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.error("Could not read .env.local — make sure it exists.");
  process.exit(1);
}

const domain = process.env.SHOPIFY_STORE_DOMAIN;
const token  = process.env.SHOPIFY_ACCESS_TOKEN;

if (!domain || !token) {
  console.error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const API_VERSION = "2025-10";
const endpoint = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

async function gql(query, variables = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const LIST_QUERY = `
  query ListMetaobjects($type: String!, $cursor: String) {
    metaobjects(type: $type, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        capabilities {
          publishable { status }
        }
      }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation PublishMetaobject($id: ID!) {
    metaobjectUpdate(id: $id, metaobject: { capabilities: { publishable: { status: ACTIVE } } }) {
      metaobject { id handle }
      userErrors { field message }
    }
  }
`;

const ENABLE_DEF_MUTATION = `
  mutation EnablePublishable($defId: ID!) {
    metaobjectDefinitionUpdate(id: $defId, definition: {
      capabilities: { publishable: { enabled: true } }
    }) {
      metaobjectDefinition { id }
      userErrors { field message }
    }
  }
`;

const GET_DEF_QUERY = `
  query GetDef($type: String!) {
    metaobjectDefinitionByType(type: $type) { id }
  }
`;

async function listAll(type) {
  const nodes = [];
  let cursor = undefined;
  while (true) {
    const data = await gql(LIST_QUERY, { type, ...(cursor ? { cursor } : {}) });
    nodes.push(...data.metaobjects.nodes);
    if (!data.metaobjects.pageInfo.hasNextPage) break;
    cursor = data.metaobjects.pageInfo.endCursor;
  }
  return nodes;
}

async function enablePublishableOnDef(type) {
  try {
    const data = await gql(GET_DEF_QUERY, { type });
    const defId = data.metaobjectDefinitionByType?.id;
    if (!defId) {
      console.log(`  No definition found for type "${type}" — skipping.`);
      return false;
    }
    const res = await gql(ENABLE_DEF_MUTATION, { defId });
    const errs = res.metaobjectDefinitionUpdate.userErrors;
    if (errs.length > 0) {
      console.log(`  Definition update note: ${errs.map(e => e.message).join(", ")}`);
    } else {
      console.log(`  Publishable capability enabled on "${type}" definition.`);
    }
    return true;
  } catch (err) {
    if (/ACCESS_DENIED|access scope/i.test(err.message)) {
      console.log(`  Skipping definition update (token lacks definition scope — OK if definition already has publishable enabled).`);
      return false;
    }
    throw err;
  }
}

async function publishAll(type) {
  console.log(`\n=== ${type} ===`);

  // Step 1: ensure the definition has publishable capability enabled
  await enablePublishableOnDef(type);

  // Step 2: list all instances
  const nodes = await listAll(type);
  if (nodes.length === 0) {
    console.log("  No instances found.");
    return;
  }

  // Step 3: report status of each instance
  const drafts = [];
  for (const node of nodes) {
    const status = node.capabilities?.publishable?.status ?? "UNKNOWN";
    const label = status === "ACTIVE" ? "active    " : status === "DRAFT" ? "DRAFT <<<" : status;
    console.log(`  ${label}  ${node.handle}`);
    if (status !== "ACTIVE") drafts.push(node);
  }

  if (drafts.length === 0) {
    console.log("  All instances are already active — nothing to do.");
    return;
  }

  console.log(`\n  Publishing ${drafts.length} draft instance(s)...`);

  // Step 4: publish drafts only
  for (const node of drafts) {
    try {
      const res = await gql(UPDATE_MUTATION, { id: node.id });
      const errs = res.metaobjectUpdate.userErrors;
      if (errs.length > 0) {
        const msgs = errs.map(e => e.message).join(", ");
        if (/capabilit/i.test(msgs)) {
          console.log(`  ${node.handle}: no publishable capability (always visible) — OK`);
        } else {
          console.log(`  ${node.handle}: ERROR — ${msgs}`);
        }
      } else {
        console.log(`  ${node.handle}: published (ACTIVE)`);
      }
    } catch (err) {
      console.log(`  ${node.handle}: ERROR — ${err.message}`);
    }
  }
}

console.log("Checking metaobject publish status...");
await publishAll("pdp_app_settings");
await publishAll("pdp_icon");
console.log("\nDone.");
