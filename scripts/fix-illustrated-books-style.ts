/**
 * One-off: rename "Illustrated" → "Illustrated books" in the WCT/PF library entries
 * stored in the Shopify metaobject. Run this when the taxonomy rename completed but the
 * library cascade was skipped.
 *
 * Run: npx tsx --env-file .env.local scripts/fix-illustrated-books-style.ts
 */

import { renameStyleInLibrary } from "../lib/library-edits-store";

const TYPE = "Books & Stationery";
const OLD = "Illustrated books";
const NEW = "Illustrated Books";

console.log(`Renaming "${OLD}" → "${NEW}" in library entries for type "${TYPE}"…`);

renameStyleInLibrary(TYPE, OLD, NEW)
  .then(({ wctUpdated, pfUpdated }) => {
    console.log(`Done. WCT entries updated: ${wctUpdated}, PF entries updated: ${pfUpdated}`);
  })
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
