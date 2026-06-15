# Plan: Migrate Library Base Data into Shopify Metaobject

## Context

The app currently stores library content in two layers:
1. **Static JSON files** (shipped with the code): `data/why-choose-this.json` (156 WCT entries), `data/pf-phrases.json` (68 phrases), `data/pf-applicability.json` (150 rows)
2. **Shopify `pdp_library_edits` metaobject**: user edits and new entries layered on top

Every read path merges these two layers, making the rename cascade complicated (it has to detect base vs. custom entries and handle them differently). The goal is to move all base data into the metaobject so there is one source of truth and the merge logic can be deleted.

**Size constraint:** The merged payload is ~69 KB, which exceeds the 65,535-char limit for a single `multi_line_text_field`. Solution: split into two fields on the same metaobject — `edits_json` for WCT data (~34 KB) and `pf_json` for PF phrases + applicability + icons (~35 KB).

---

## Step 1 — Two-field split in `library-edits-store.ts`

**File:** `lib/library-edits-store.ts`

Update the metaobject definition to declare both fields. The `QUERY` already returns `fields { key value }` (all fields), so only the read and write sides need changing.

**`getLibraryEdits()`:** After fetching the node, look up both `edits_json` and `pf_json` keys. Parse each separately and merge into one `LibraryEdits` object:
- `edits_json` → `{ wct }`
- `pf_json` → `{ pfPhrases, pfApplicability, uploadedIcons }`

**`persist(edits)`:** Split into two payloads and pass both to the existing UPDATE/CREATE mutations:
```ts
f = [
  { key: "edits_json", value: JSON.stringify({ wct: edits.wct }) },
  { key: "pf_json",    value: JSON.stringify({ pfPhrases: edits.pfPhrases, pfApplicability: edits.pfApplicability, uploadedIcons: edits.uploadedIcons }) }
]
```

**`CREATE_DEF` mutation:** Add both field definitions so auto-creation works on a fresh store.

**Remove:** The two base JSON imports added in the previous session:
```ts
// DELETE:
import wctBaseData from "@/data/why-choose-this.json";
import pfApplicabilityBaseData from "@/data/pf-applicability.json";
```

**`normalise()`:** Update to accept a partial split across two parsed objects (call twice and spread).

The fallback `data/library-edits.json` seed path remains unchanged — it already contains the full merged object.

---

## Step 2 — Migration script: `scripts/migrate-library-to-metaobject.mjs`

New standalone script (ES module, follows the pattern of `fix-library-practical-to-utility.mjs`).

**Algorithm:**
1. Load `.env.local` manually (same pattern as existing script)
2. Fetch current `pdp_library_edits` metaobject (both fields, `pf_json` may not exist yet)
3. Parse existing edits from both fields
4. Read the three base JSON files with `fs.readFileSync`
5. **Build merged `wct` record:** For each base WCT entry, apply any existing edit overrides (text, subtext, category, searchFormatted), set `isNew: false`. Then add `isNew: true` entries from existing edits.
6. **Build merged `pfPhrases` record:** For each base phrase, apply edit overrides (phrase, icon, category, timeSensitive, filterByInterest, minPrice, maxPrice, deleted), set `isNew: false`, set `searchPhrase` from edit or base phrase text. Then add `isNew: true` custom phrases.
7. **Build merged `pfApplicability` record:** For each base row, apply edit overrides, preserve `deleted: true`. Then add `isNew: true` rows.
8. Preserve `uploadedIcons` from existing edits unchanged.
9. Before writing: ensure `pf_json` field exists on the metaobject definition (add it via `metaobjectDefinitionUpdate` if missing)
10. On `--dry-run`: print entry counts and payload sizes, confirm both under 65,535 chars, exit without saving
11. On live run: write both fields to the metaobject, then overwrite `data/library-edits.json` with the full merged object (emergency seed refresh)

**Add to `package.json`:**
```json
"migrate-library": "node scripts/migrate-library-to-metaobject.mjs"
```

---

## Step 3 — Simplify `renameStyleInLibrary` in `library-edits-store.ts`

After migration, all entries are in the metaobject. The current function has two-path logic (update custom entries directly; create override records for base entries). After migration, all entries are already in `edits.wct` and `edits.pfApplicability`, so both loops collapse to one:

```ts
for (const entry of Object.values(edits.wct)) {
  if (entry.productType === productType && entry.productStyle === oldStyle) {
    entry.productStyle = newStyle;
    wctUpdated++;
  }
}
for (const entry of Object.values(edits.pfApplicability)) {
  if (entry.productType === productType && entry.productStyle === oldStyle) {
    entry.productStyle = newStyle;
    pfUpdated++;
  }
}
```

---

## Step 4 — Simplify `lib/wct-store.ts`

Remove: `import wctBase from "@/data/why-choose-this.json"` and the `base` constant.

`getWctLibrary()` becomes a direct map over `edits.wct` (no merge needed):
```ts
export async function getWctLibrary(): Promise<WhyChooseThisEntry[]> {
  const edits = await getLibraryEdits();
  return Object.values(edits.wct).map((e) => ({
    id: e.id,
    productType: e.productType,
    productStyle: e.productStyle,
    category: e.category as WhyChooseThisEntry["category"],
    text: e.text,
    subtext: e.subtext,
  }));
}
```

---

## Step 5 — Simplify `lib/pf-store.ts`

Remove: `import pfPhrasesBase from "@/data/pf-phrases.json"`, `import pfApplicabilityBase from "@/data/pf-applicability.json"`, and the `basePhrases`/`baseApplicability` constants.

**`buildPhraseMap()`:** Iterate `edits.pfPhrases` directly (no base merge loop).

**`buildApplicabilityList()`:** Return `Object.values(edits.pfApplicability).filter(e => !e.deleted).map(...)`.

**`removeApplicability(appId)`:** Remove the `base = baseApplicability.find(...)` lookup. The entry is now always in `edits.pfApplicability`:
```ts
const entry = edits.pfApplicability[appId];
if (!entry) return;
if (entry.isNew) {
  await deletePFApplicabilityEdit(appId);
} else {
  await upsertPFApplicabilityEdit({ ...entry, deleted: true });
}
```

**`deletePhrase(phraseId)`:** Remove the `base = basePhrases.find(...)` lookup. Read phrase text from `edits.pfPhrases[phraseId]` directly.

`savePhraseEdit()` and `savePhraseIcon()` already use `buildPhraseMap()` — no changes needed.

---

## Step 6 — Update API routes

Four files need their base JSON imports removed and inline merge logic replaced with store calls:

**`app/api/library/route.ts`** (GET handler for WCT): Remove direct `wctData` import. Replace the inline merge with `await getWctLibrary()`, then filter on that result.

**`app/api/library/entry/route.ts`** (POST/PUT for WCT): Remove `wctData` import. The `searchFormatted` fallback that looked up `wctLibrary.find(...)` should instead read from `edits.wct[entryId]` (the entry is always there after migration).

**`app/api/library/find/route.ts`** (WCT lookup for bulk content review): Remove `wctData` import. Replace `wctLibrary.find(e => e.id === id)` with `edits.wct[id]` direct lookup.

**`app/api/bulk-content-review/route.ts`**: Remove `wctBase` import and the 9-line inline WCT merge block (currently around lines 80–89). Replace with `await getWctLibrary()` added to the existing `Promise.all`.

---

## Step 7 — Refresh `data/library-edits.json`

After the migration script runs successfully, the script writes the full merged object back to `data/library-edits.json`. This keeps the emergency seed file up to date. The three base JSON files remain on disk as historical records but are no longer imported at runtime.

---

## Execution order (important)

1. **Dry-run the migration script** (Step 2, read-only) — validate sizes and entry counts
2. **Implement Step 1** (two-field split) and deploy — app is still backward compatible (pf_json missing → falls back to empty, existing edits_json still readable)
3. **Run migration script live** against production Shopify — both fields populated
4. **Implement Steps 3–6** in one PR — all simplifications, remove base JSON imports
5. Verify, then optionally clean up base JSON files (or leave them as reference)

---

## Verification

1. **Pre-migration dry run:** `node scripts/migrate-library-to-metaobject.mjs --dry-run` — confirms entry counts and both payloads under 65,535 chars
2. **Post-migration data check:** Shopify Admin → Custom Data → Metaobjects → `pdp_library_edits` — both `edits_json` and `pf_json` populated
3. **Library UI smoke test:** `/library?type=why` shows all WCT entries; `/library?type=pf` shows all phrases. Existing custom entries present.
4. **Style rename test:** Rename a style in Product Types, confirm SSE stream reports correct library update count, verify entries in Shopify Admin reflect new style name
5. **Delete/create cycle:** Delete a phrase, create a new one — confirm in UI and in metaobject
6. **Bulk content review:** Run on a product with a known type/style — confirm correct WCT and PF bullets assigned
