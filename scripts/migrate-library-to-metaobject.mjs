// One-time script: move base library data (WCT entries, PF phrases, PF applicability rows)
// from the static JSON files into the pdp_library_edits metaobject, so it becomes the
// single source of truth and the base-vs-custom merge logic can be deleted.
//
// Usage:
//   node scripts/migrate-library-to-metaobject.mjs            (live run)
//   node scripts/migrate-library-to-metaobject.mjs --dry-run   (preview only, no save)
//
// Requires the pf_json field to already exist on the pdp_library_edits metaobject
// definition (added manually via Shopify Admin → Settings → Custom data).

const DRY_RUN = process.argv.includes("--dry-run");

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mergeWct, mergePfPhrases, mergePfApplicability } from "./lib/migrate-library-merge.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = join(root, ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const val = trimmed.slice(eq + 1).trim();
  env[trimmed.slice(0, eq).trim()] = val.replace(/^["']|["']$/g, "");
}

const DOMAIN = env.SHOPIFY_STORE_DOMAIN;
const TOKEN  = env.SHOPIFY_ACCESS_TOKEN;
const API    = `https://${DOMAIN}/admin/api/2025-10/graphql.json`;

if (!DOMAIN || !TOKEN) {
  console.error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

// ── Shopify GraphQL helper ────────────────────────────────────────────────────
async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ── Queries / mutations ───────────────────────────────────────────────────────
const QUERY = `
  query {
    metaobjects(type: "pdp_library_edits", first: 1) {
      nodes { id fields { key value } }
    }
  }
`;

const UPDATE = `
  mutation Update($id: ID!, $f: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $f }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

// ── Fetch current metaobject + existing edits ─────────────────────────────────
if (DRY_RUN) console.log("DRY RUN — no changes will be saved.\n");
console.log("Fetching current library edits from Shopify…");
const data = await gql(QUERY);
const node = data.metaobjects.nodes[0];

if (!node) {
  console.error("No pdp_library_edits metaobject found. Create the metaobject definition (and an entry) first.");
  process.exit(1);
}

const edits_jsonField = node.fields.find((f) => f.key === "edits_json");
const pf_jsonField    = node.fields.find((f) => f.key === "pf_json");

const existingWct = edits_jsonField?.value ? (JSON.parse(edits_jsonField.value).wct ?? {}) : {};
const existingPf  = pf_jsonField?.value ? JSON.parse(pf_jsonField.value) : {};
const existingPfPhrases      = existingPf.pfPhrases ?? {};
const existingPfApplicability = existingPf.pfApplicability ?? {};
const existingUploadedIcons   = existingPf.uploadedIcons ?? [];

if (!pf_jsonField && !DRY_RUN) {
  console.error("pf_json field not found on the metaobject. Add it in Shopify Admin → Settings → Custom data → PDP Library Edits before running live.");
  process.exit(1);
}

// ── Load base JSON files ──────────────────────────────────────────────────────
const wctBase = JSON.parse(readFileSync(join(root, "data", "why-choose-this.json"), "utf-8")).data;
const pfPhrasesBase = JSON.parse(readFileSync(join(root, "data", "pf-phrases.json"), "utf-8")).data;
const pfApplicabilityBase = JSON.parse(readFileSync(join(root, "data", "pf-applicability.json"), "utf-8")).data;

// ── Build merged records (pure logic lives in lib/migrate-library-merge.mjs,
// shared with the unit tests) ───────────────────────────────────────────────
const mergedWct = mergeWct(wctBase, existingWct);
const mergedPfPhrases = mergePfPhrases(pfPhrasesBase, existingPfPhrases);
const mergedPfApplicability = mergePfApplicability(pfApplicabilityBase, existingPfApplicability);

// ── Assemble final payloads ────────────────────────────────────────────────────
const wctPayload = { wct: mergedWct };
const pfPayload = {
  pfPhrases: mergedPfPhrases,
  pfApplicability: mergedPfApplicability,
  uploadedIcons: existingUploadedIcons,
};

const wctJson = JSON.stringify(wctPayload);
const pfJson = JSON.stringify(pfPayload);

console.log(`\nWCT entries:            ${Object.keys(mergedWct).length} (${wctBase.length} base + ${Object.keys(mergedWct).length - wctBase.length} custom)`);
console.log(`PF phrases:              ${Object.keys(mergedPfPhrases).length} (${pfPhrasesBase.length} base + ${Object.keys(mergedPfPhrases).length - pfPhrasesBase.length} custom)`);
console.log(`PF applicability rows:   ${Object.keys(mergedPfApplicability).length} (${pfApplicabilityBase.length} base + ${Object.keys(mergedPfApplicability).length - pfApplicabilityBase.length} custom)`);
console.log(`Uploaded icons:          ${existingUploadedIcons.length}`);
console.log(`\nedits_json payload size: ${wctJson.length} chars`);
console.log(`pf_json payload size:    ${pfJson.length} chars`);

const LIMIT = 65535;
const overLimit = [];
if (wctJson.length > LIMIT) overLimit.push("edits_json");
if (pfJson.length > LIMIT) overLimit.push("pf_json");
if (overLimit.length > 0) {
  console.error(`\n${overLimit.join(" and ")} exceed${overLimit.length === 1 ? "s" : ""} the ${LIMIT}-char field limit. Aborting.`);
  process.exit(1);
}
console.log(`\nBoth payloads are under the ${LIMIT}-char field limit.`);

if (DRY_RUN) {
  console.log("\nDry run complete — no changes saved.");
  process.exit(0);
}

// ── Live run: write both fields, then refresh the local seed file ──────────────
console.log("\nSaving merged data to Shopify metaobject…");
const result = await gql(UPDATE, {
  id: node.id,
  f: [
    { key: "edits_json", value: wctJson },
    { key: "pf_json", value: pfJson },
  ],
});

const errors = result.metaobjectUpdate.userErrors;
if (errors.length > 0) {
  console.error("Shopify save failed:", errors);
  process.exit(1);
}

const fullMerged = {
  wct: mergedWct,
  pfPhrases: mergedPfPhrases,
  pfApplicability: mergedPfApplicability,
  uploadedIcons: existingUploadedIcons,
};
writeFileSync(join(root, "data", "library-edits.json"), JSON.stringify(fullMerged, null, 2) + "\n");

console.log("Done. Metaobject updated and data/library-edits.json refreshed with the full merged dataset.");
