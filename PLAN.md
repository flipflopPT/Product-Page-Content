# PDP Content Management App — Implementation Plan

## Context

PT's product page redesign (pdp-redesign template) requires three content sections per product:

1. **Product Summary** — AI-generated elevator pitch displayed above the price. Claude generates 3 options per product; staff pick one, edit it, or regenerate. Formula: [Aesthetic benefit] + [Functional benefit] + [Permission to buy] with a tension-resolving line (e.g. "Looks expensive, but..."). Source: Shopify product title + description + assigned type/style.

2. **Why People Love This** — 4 bullets from a pre-written library, one per fixed category (Stands Out / Gift Impact / Trusted Pick / Worth Keeping), selected by product type and style. Icons are hardcoded per slot position in the theme — so slot order is fixed.

3. **Perfect For** — 4 bullets from a pre-written library, selected by product type + style with date-range and interest filtering. Staff can reorder these bullets. Icons are stored as metafields and rendered by the theme.

Content library data is in `PDP Content Management/Reasons to Buy.xlsx` (~175 Why + ~155 Perfect For entries).

---

## Confirmed Metafield Schema (from theme source)

| Namespace | Key | Type | Notes |
|---|---|---|---|
| `product` | `product_summary` | `multi_line_text_field` | AI-generated, rendered with `| newline_to_br` |
| `product` | `product_type_pt` | `single_line_text_field` | PT product type (app's source of truth) |
| `product` | `product_style_pt` | `single_line_text_field` | PT product style (comma-separated if multiple) |
| `why-choose-this` | `bullet_1` | `multi_line_text_field` | Stands Out — stored as `<strong>Text</strong> Subtext` |
| `why-choose-this` | `bullet_2` | `multi_line_text_field` | Gift Impact — same format |
| `why-choose-this` | `bullet_3` | `multi_line_text_field` | Trusted Pick — same format |
| `why-choose-this` | `bullet_4` | `multi_line_text_field` | Worth Keeping — same format |
| `perfect-for` | `perfect_bullet_1` | `single_line_text_field` | Phrase text only |
| `perfect-for` | `perfect_bullet_2` | `single_line_text_field` | |
| `perfect-for` | `perfect_bullet_3` | `single_line_text_field` | |
| `perfect-for` | `perfect_bullet_4` | `single_line_text_field` | |
| `perfect-for` | `icon_1` | `single_line_text_field` | SVG string or Shopify Files CDN URL |
| `perfect-for` | `icon_2` | `single_line_text_field` | |
| `perfect-for` | `icon_3` | `single_line_text_field` | |
| `perfect-for` | `icon_4` | `single_line_text_field` | |

**Why Choose This bullet format:** Stored as HTML in a `multi_line_text_field` — e.g. `<strong>Dainty gold that doesn't date</strong> Delicate everyday pieces with lasting style`. The app writes the HTML string; the theme renders it. **Important note for theme developer:** Shopify Liquid auto-escapes output from text metafields, so `{{ b1 }}` would render the HTML tags as visible text. The theme must use a JavaScript `innerHTML` assignment instead:
```html
<span class="pdp-r-feature-bullets__label" id="wct-b1"></span>
<script>document.getElementById('wct-b1').innerHTML = {{ b1.value | json }};</script>
```
This renders the `<strong>` correctly in the browser. The `| json` filter outputs a safely JSON-encoded string that JavaScript can parse and assign as HTML.

**Why Choose This icons (fixed per slot, defined in theme liquid):**
- Slot 1 (Stands Out) → sparkle/star SVG
- Slot 2 (Gift Impact) → heart SVG
- Slot 3 (Trusted Pick) → shield SVG
- Slot 4 (Worth Keeping) → gift-with-heart SVG

These icons are hardcoded in the theme per slot position, so slot order is locked to category order. Staff can swap content within a slot but not move a "Stands Out" bullet to slot 3.

**Perfect For icons:** Each library entry has an `icon` field. The app has a built-in set of ~50 SVG icons (bundled in `/public/icons/`). Staff can also upload new SVG icons via app settings — these are uploaded to Shopify Files API and get a permanent CDN URL. When a product's Perfect For bullets are saved, the corresponding icon SVG string (or CDN URL) is written to `perfect-for.icon_1`–`icon_4`. The theme renders `{{ product.metafields["perfect-for"].icon_1 }}` directly. No keyword-matching in the theme — icons are explicit per entry.

---

## Tech Stack

- **Next.js App Router** + TypeScript + Tailwind v4 (requires `postcss.config.mjs` with `@tailwindcss/postcss`)
- **Shopify Admin GraphQL API** for product reads and metafield writes
- **Claude API** (`claude-sonnet-4-6`) for Product Summary generation
- **Shopify Files API** for icon SVG uploads
- **Auth:** Shopify OAuth — copy `app/api/auth/route.ts` + `app/api/auth/callback/route.ts` from Reorder Collections Tool (direct access token used for local dev)
- **`lib/shopify.ts`:** copy directly from `/Users/philippa/Projects/PT/Reorder Collections Tool/lib/shopify.ts`
- **Settings storage:** Shopify Metaobject (persists in Shopify, survives any deployment)
- **Deploy:** Vercel (consistent with other PT tools)

### Known quirks discovered during build
- Shopify Admin GQL does **not** support `metafields(identifiers:[...])` on product nodes. Use individual aliased `metafield(namespace:, key:)` calls instead.
- Tailwind v4 requires `postcss.config.mjs` with `@tailwindcss/postcss` — without it, zero styles apply.
- Page root must use `h-screen` (not `min-h-screen`) so the sticky save footer works correctly in the flex chain.
- Excel import produces curly apostrophes (U+2019) — both JSON data files must have these normalised to straight apostrophes (U+0027) or taxonomy string matching silently fails.

---

## Project Structure

```
Build/
├── shopify.app.toml
├── next.config.ts           (copy from Reorder Collections Tool — CSP headers)
├── postcss.config.mjs       (required for Tailwind v4)
├── vercel.json
├── package.json
├── tsconfig.json
├── .env.local
│
├── data/
│   ├── why-choose-this.json     (168 entries from Excel)
│   ├── perfect-for.json         (151 entries from Excel)
│   └── taxonomy.ts              (product type → valid styles)
│
├── public/
│   └── icons/                   (built-in SVG icon set, ~50 files)
│       ├── cake.svg
│       ├── heart.svg
│       ├── house.svg
│       └── ...
│
├── scripts/
│   └── import-content.ts        (one-off: Excel → JSON, already run)
│
├── lib/
│   ├── shopify.ts               (copied from Reorder Collections Tool)
│   ├── metafields.ts            ✅ GQL read + write helpers
│   ├── assignment-engine.ts     ✅ bullet selection logic
│   ├── generate-summary.ts      ✅ Claude API — Product Summary generation
│   ├── settings-store.ts        ⬜ read/write via Shopify Metaobject
│   └── icons.ts                 ⬜ built-in icon list + Shopify Files upload
│
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── page.tsx                 (redirect to /products)
│   ├── products/page.tsx        ✅ product list + inline editor
│   ├── bulk/page.tsx            ⬜ bulk assign
│   ├── library/page.tsx         ⬜ browse + manage content library
│   ├── settings/page.tsx        ⬜ date range config + icon upload
│   └── api/
│       ├── auth/route.ts                ✅ (copied from Reorder Collections Tool)
│       ├── auth/callback/route.ts       ✅
│       ├── products/route.ts            ✅
│       ├── products/[id]/route.ts       ✅
│       ├── products/[id]/assign/route.ts ✅
│       ├── generate-summary/route.ts    ✅
│       ├── preview/route.ts             ✅
│       ├── bulk-assign/route.ts         ⬜
│       ├── library/route.ts             ✅ (read-only for now)
│       ├── icons/route.ts               ⬜
│       ├── settings/route.ts            ⬜
│       └── health/route.ts              ✅
```

---

## Data Files

### `data/taxonomy.ts`
```typescript
export const PRODUCT_TAXONOMY: Record<string, string[]> = {
  "Bags & Purses":                 ["Elegant", "Personalised", "Practical", "Bold/Colourful"],
  "Home":                          ["Bold/Colourful", "Classic/Timeless", "Earthy/Natural", "Minimal", "Playful", "EcoFriendly"],
  "Women's Jewellery":             ["Dainty", "Minimal", "Personalised", "Statement"],
  "Children's Jewellery":          ["Dainty", "Minimal", "Personalised"],
  "Men's Jewellery & Accessories": ["Classic", "Modern", "Personalised"],
  "Children":                      ["Classic/Timeless", "Playful", "Creative"],
  "Books & Stationery":            ["Illustrated", "Inspirational", "Practical"],
  "Personalised Accessories":      ["Classic", "Novelty"],
  "Candles / Diffusers":           ["Novelty", "Premium"],
  "Greetings Cards":               ["Nature", "Novelty/Humorous"],
  "Fairy Lights":                  ["Minimal", "Decorative", "Colourful"],
  "Furniture & Lighting":          ["Minimal", "Scandi", "Statement", "Contemporary Classic"],
  "Christmas Themed Products":     ["Traditional", "Minimal", "Novelty"],
};

export function isValidCombination(type: string, style: string): boolean {
  return PRODUCT_TAXONOMY[type]?.includes(style) ?? false;
}
```

### `data/why-choose-this.json` (shape per entry)
```json
{
  "id": "wct-001",
  "productType": "Women's Jewellery",
  "productStyle": "Dainty",
  "category": "Stands Out",
  "text": "Dainty gold that doesn't date",
  "subtext": "Delicate everyday pieces with lasting style"
}
```
Categories must be exactly: `"Stands Out"` | `"Gift Impact"` | `"Trusted Pick"` | `"Worth Keeping"`

### `data/perfect-for.json` (shape per entry)
```json
{
  "id": "pf-001",
  "productType": "ALL",
  "productStyle": "ALL",
  "category": "Occasion",
  "phrase": "Birthdays",
  "filterByInterest": false,
  "timeSensitive": null,
  "applicabilityCount": 52,
  "icon": "cake"
}
```
- `timeSensitive`: `null` | `"mothers-day"` | `"fathers-day"` | `"valentines-day"` — derived during import
- `applicabilityCount`: count of (type, style) combos this entry matches — precomputed at import
- `icon`: name of icon file in `/public/icons/` or a full CDN URL (for uploaded icons)

### `scripts/import-content.ts`
One-off script using `xlsx` package. Already run. Source: `npx tsx scripts/import-content.ts "./Reasons to Buy.xlsx"`

Steps:
1. Read "Why Choose This" sheet → map to `WhyChooseThisEntry[]` → write `data/why-choose-this.json`
2. Read "Perfect For" sheet → detect `timeSensitive` from phrase keywords → compute `applicabilityCount` → assign a sensible default icon per phrase → write `data/perfect-for.json`
3. **Post-process:** normalise curly apostrophes (U+2019) to straight (U+0027) in all `productType` and `productStyle` fields — required for taxonomy matching to work.

---

## Assignment Engine (`lib/assignment-engine.ts`) ✅

### `assignWhyChooseThis(product, library)`

```
For each CATEGORY in ["Stands Out", "Gift Impact", "Trusted Pick", "Worth Keeping"]:
  candidates = library filtered by:
    - productType == product.productType
    - productStyle is in product.productStyles[]   ← multi-style: any match counts
    - category == CATEGORY

  If empty → slot is null (no match for this combination)
  Otherwise → pick one at random

  Format for storage: "<strong>{entry.text}</strong> {entry.subtext}"

Return: { bullet1, bullet2, bullet3, bullet4 }
  bullet1 = Stands Out result
  bullet2 = Gift Impact result
  bullet3 = Trusted Pick result
  bullet4 = Worth Keeping result
```

Slots are fixed to categories because the theme icons are hardcoded per slot position.

### `assignPerfectFor(product, library, dateConfig, today, seed?, seasonalOverrides?)`

```
Step 1 — Filter candidates:
  Include entry if ALL of:
    - productType matches (== product.productType OR == "ALL")
    - productStyle matches (any of product.productStyles[] OR == "ALL")
    - NOT time-sensitive OR today is within configured date range
      OR seasonalOverrides[key] === true  ← per-product override checkbox
    - NOT filterByInterest OR productMatchesInterest(product, entry)

Step 2 — Sort by specificity:
  Primary:   productStyle != "ALL" ranks before "ALL"
  Secondary: lower applicabilityCount ranks first (more niche = more relevant)

Step 3 — Pick 4 with category diversity:
  Greedy selection: always pick from whichever of
  Occasion / Person / Context has fewest selections so far.
  This ensures the 4 bullets aren't all the same category type.

Return: array of up to 4 PerfectForEntry (with icon field)
```

### `productMatchesInterest(product, entry)` — Phase 3
Build a keyword map for the ~17 interest-filtered entries after reviewing them in the library browser (Phase 1 and 2 include all interest-filtered entries unconditionally as a safe starting point).

---

## Product Summary Generation (`lib/generate-summary.ts`) ✅

```typescript
async function generateProductSummary(
  product: { title: string; descriptionHtml: string; productType: string; productStyle: string }
): Promise<{ options: string[] } | { error: GenerationError }>
```

**Claude prompt structure (`claude-sonnet-4-6`):**
- System: PT brand voice; formula [Aesthetic] + [Functional] + [Permission to buy]; must include tension-resolving line; **no dashes of any kind** (em-dash, en-dash, hyphen); no exclamation marks; no generic phrases; one or two short sentences; British audience.
- User: product title, type, style, description (plain text stripped from HTML, truncated to 1000 chars).
- Returns exactly 3 distinct options, numbered 1–3.

**Cost:** ~$0.01–0.02 per generation call. Suitable for on-demand per-click use.

**Error handling (inline below Generate button):**
- No API key configured: "Anthropic API key is not configured…"
- HTTP 402 / `credit_balance_too_low`: "You've run out of Anthropic API credits. [Add credits →](https://console.anthropic.com)"
- HTTP 401: "Anthropic API key is invalid — check your environment settings"
- HTTP 429: "Too many requests — please wait a moment and try again"
- Network errors (ECONNREFUSED etc): "Unable to connect to Anthropic — check your internet connection"
- Other: "Generation failed — please try again or write the summary manually"

**UI flow:**
1. Staff opens a product in the editor
2. "Generate options" button → calls `POST /api/generate-summary`
3. Returns 3 options displayed as selectable cards
4. Staff clicks a card (pre-fills textarea) or types directly
5. Saves with the main Save button

---

## Metafields Helper (`lib/metafields.ts`) ✅

```typescript
async function getProductWithMetafields(productGid: string): Promise<{ product: ProductData }>
async function setProductMetafields(productGid: string, data: Partial<ProductMetafieldData>): Promise<void>
```

`setProductMetafields` uses the `metafieldsSet` GQL mutation. Accepts hyphenated namespaces directly (e.g. `"why-choose-this"` is valid in the Shopify GQL API). All 15 metafields (3 product + 4 why-choose-this + 4 perfect-for phrases + 4 perfect-for icons) are written in a single mutation call.

**Important:** Use individual aliased `metafield(namespace:, key:)` calls in GQL queries — `metafields(identifiers:[...])` is not supported on product nodes.

---

## Settings Store (`lib/settings-store.ts`) ⬜

Settings stored as a **Shopify Metaobject** so they survive Vercel deployments.

```typescript
interface AppSettings {
  dateRanges: {
    mothersDay:    { start: string; end: string } | null;
    fathersDay:    { start: string; end: string } | null;
    valentinesDay: { start: string; end: string } | null;
  };
}

async function getSettings(): Promise<AppSettings>
async function saveSettings(s: AppSettings): Promise<void>
```

On first save, creates a Metaobject of type `pdp_app_settings`. Subsequent saves update the existing one. GQL mutations: `metaobjectCreate` / `metaobjectUpdate`. GQL query: `metaobjects(type: "pdp_app_settings")`.

---

## Icon System (`lib/icons.ts`) ⬜

**Built-in icons:** ~50 SVG files in `/public/icons/`. Names correspond to `icon` field values in `perfect-for.json` (e.g. `"cake"` → `/public/icons/cake.svg`).

**Custom uploaded icons:** Staff upload SVG via app settings → `POST /api/icons` → uploaded to Shopify Files API (`fileCreate` mutation) → permanent CDN URL saved to a Shopify Metaobject (type `pdp_uploaded_icons`).

**Reuse:** All uploaded icons appear in the icon picker across every library entry — built-in and uploaded icons are shown together in a single grid. Uploading once makes an icon available forever.

**Distinguishing built-in from uploaded:** If `icon` value starts with `https://`, it's a CDN URL (rendered as `<img src="..." class="pdp-r-icon" aria-hidden="true">`). Otherwise it's a name pointing to `/public/icons/{name}.svg` (rendered as inline SVG). The theme liquid applies the same distinction.

**Adding icons to the built-in set:** Requires a developer to add an SVG to `/public/icons/` and redeploy. The upload flow is the no-developer path — any number of icons can be added by staff without code changes.

---

## API Routes

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/auth` | ✅ | Shopify OAuth start |
| GET | `/api/auth/callback` | ✅ | OAuth callback |
| GET | `/api/products` | ✅ | Paginated product list with content status |
| GET | `/api/products/[id]` | ✅ | Single product + all metafields + auto-preview |
| POST | `/api/products/[id]/assign` | ✅ | Save all metafields to Shopify |
| POST | `/api/generate-summary` | ✅ | Claude generates 3 Product Summary options |
| POST | `/api/preview` | ✅ | Dry-run assignment (returns bullets, no save) |
| POST | `/api/bulk-assign` | ⬜ | Assign multiple products; streams SSE progress |
| GET | `/api/library` | ✅ | Filtered library entries (read-only) |
| POST | `/api/library` | ⬜ | Add new library entry (Phase 3) |
| GET | `/api/icons` | ⬜ | List available icons (built-in + uploaded) |
| POST | `/api/icons` | ⬜ | Upload new SVG icon to Shopify Files |
| GET/POST | `/api/settings` | ⬜ | Read/write Shopify Metaobject settings |
| GET | `/api/health` | ✅ | Vercel health check |

**`POST /api/generate-summary` body:**
```typescript
{ productId: string }
// Fetches title + description from Shopify internally, then generates 3 options
```
Returns: `{ options: string[] }` — array of 3 plain text strings.

**`POST /api/products/[id]/assign` body:**
```typescript
{
  productSummary: string;
  productTypePt: string;
  productStylesPt: string[];        // array, stored comma-separated
  whyChooseThis: { bullet1: string; bullet2: string; bullet3: string; bullet4: string };
  // Each bullet pre-formatted as "<strong>Text</strong> Subtext"
  perfectFor: {
    bullet1: string; bullet2: string; bullet3: string; bullet4: string;
    icon1: string; icon2: string; icon3: string; icon4: string;
    // icon values are icon names or CDN URLs
  };
}
```

---

## UI Pages

### Products (`/products`) ✅

**List view:** Search by title. Filter by content status (complete / partial / missing). Shows product image, title, PT Type, PT Style, status badge.

**Editor panel:**

*Product Type + Style:*
- Product Type dropdown (13 types)
- Product Style checkboxes (multi-select, filtered to valid styles for selected type; shows validation error if stored style is invalid)
- On change → call `POST /api/preview` → update all preview panes without saving

*Product Summary:*
- Textarea showing current saved value
- "Generate options" → 3 Claude-generated selectable cards
- Staff selects a card or types directly; saves with main Save button

*Why People Love This — 4 fixed slots:*
- Slot 1: Stands Out / Slot 2: Gift Impact / Slot 3: Trusted Pick / Slot 4: Worth Keeping
- Each slot: click to edit inline (separate Text + Subtext fields)
- "Swap" button → modal of library entries filtered by type + style + category
- "Re-assign" button → runs preview and replaces all 4 WCT bullets at once
- No reorder between slots (icons are fixed per position in theme)

*Perfect For — 4 reorderable slots:*
- Up/Down arrows to reorder
- "Swap" button → modal of all library entries for this product's type + style
- Seasonal override checkboxes (Mother's Day / Father's Day / Valentine's Day) — force-include those phrases regardless of configured date ranges

*Save button* (sticky footer) → `POST /api/products/[id]/assign`

### Bulk Assign (`/bulk`) ⬜

- Multi-select product table (checkbox per row, select all)
- Filters: PT Type, PT Style, "missing content only"
- "Assign Selected" → `POST /api/bulk-assign` → SSE progress stream per product
- Products with no type/style set are skipped with a warning

### Library (`/library`) ⬜

- Two tabs: Why Choose This | Perfect For
- Why Choose This filters: Product Type, Product Style, Category
- Perfect For filters: Product Type, Product Style, Category (Occasion/Person/Context)
- Table of matching entries; Perfect For table shows icon preview alongside phrase
- (Phase 3) "Add entry" form

### Settings (`/settings`) ⬜

*Date ranges:*
- Three sections: Mother's Day, Father's Day, Valentine's Day
- Each: enable toggle + start date + end date
- When disabled → null → time-sensitive phrases excluded from auto-assignment

*Icon management:*
- Grid of all built-in icons (name + SVG preview)
- Grid of uploaded icons (CDN URL + preview)
- "Upload icon" → file picker (SVG only) → `POST /api/icons` → available in icon picker across the app

---

## Theme Changes Required ⬜

**`product-why-people-love-this.liquid`:**
1. Update the 4 SVG icon definitions: sparkle/star (slot 1), heart (slot 2), shield (slot 3), gift-with-heart (slot 4)
2. Update bullet rendering to use `innerHTML` for HTML metafield values:
```liquid
<span class="pdp-r-feature-bullets__label" id="wct-b1"></span>
<script>document.getElementById('wct-b1').innerHTML = {{ product.metafields["why-choose-this"].bullet_1.value | json }};</script>
```
Repeat for b2, b3, b4 with unique IDs.

**`product-perfect-for.liquid`:**
1. Remove keyword-matching icon logic
2. Read icon metafields: `assign ic1 = product.metafields["perfect-for"].icon_1`
3. Render icon: `{% if ic1 contains 'https://' %}<img src="{{ ic1 }}" class="pdp-r-icon" aria-hidden="true">{% else %}{{ ic1 }}{% endif %}`
4. **Seasonal injection (Task #1):** Metafields always store the 4 regular bullets. At page load, the theme must:
   - Read per-product seasonal override metafields (mothersDay / fathersDay / valentinesDay booleans)
   - Read settings date window metafields for each season (stored in `pdp_app_settings` Shopify Metaobject)
   - If today falls within an active season's window AND the product's override is true, replace one of the 4 stored bullets at random with the seasonal phrase and its icon
   - This is display-only — no metafield writes

---

## Deployment (Vercel)

No persistent storage needed — settings live in Shopify Metaobject.

**`vercel.json`:** Copy from Reorder Collections Tool.

**Environment variables:**
```
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_STORE_DOMAIN=penelopetom-office.myshopify.com
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_APP_URL=https://pt-pdp-content.vercel.app
NEXT_PUBLIC_SHOPIFY_API_KEY=
ANTHROPIC_API_KEY=
NODE_ENV=production
```

---

## Phased Delivery

### Phase 1 — Scaffold + data + individual editor ✅ COMPLETE

1. ✅ Project scaffold: Next.js, Tailwind v4, PostCSS config, auth routes, shopify.ts
2. ✅ Import script run → `data/why-choose-this.json` (168 entries) and `data/perfect-for.json` (151 entries); apostrophes normalised
3. ✅ `data/taxonomy.ts`, `lib/assignment-engine.ts`, `lib/metafields.ts`
4. ✅ `GET /api/products` + product list UI (search, status filter, pagination)
5. ✅ Individual product editor: multi-style checkboxes, auto-preview, WCT slots + Swap modal + Re-assign, Product Summary textarea, Perfect For slots + Swap + reorder + seasonal overrides
6. ✅ `POST /api/products/[id]/assign` — validates type/style, writes all 15 metafields

**Verify:** Set type/style → preview bullets → save → visit `?view=pdp-redesign` → all 3 sections render correctly.

### Phase 2 — Icons + settings store ✅ COMPLETE

1. ✅ Populate `/public/icons/` with ~25 built-in SVGs
2. ✅ `lib/icons.ts` + `GET/POST /api/icons` — built-in icon list + custom SVG upload via Shopify Metaobject (`pdp_uploaded_icons`)
3. ✅ Icon picker (`components/IconPicker.tsx`) in Perfect For Swap modal — built-in + uploaded icons
4. ✅ Icon preview alongside each Perfect For slot in the editor; `normalizeIcon()` handles SVG↔name round-trip
5. ✅ `lib/settings-store.ts` using Shopify Metaobject (`pdp_app_settings`)
6. ✅ Settings page: date range pickers for Mother's/Father's/Valentine's Day (no toggles — blank = off)
7. ✅ Perfect For Icons page (`/icons`) — icon library + phrase assignments grouped by icon; click phrase to reassign
8. ✅ `lib/pf-icon-overrides-store.ts` + `PATCH /api/library` — icon overrides stored in Shopify Metaobject (`pdp_pf_icon_overrides`); merged into library responses at read time
9. ✅ Seasonal phrase logic fixed — seasonal entries never stored in metafields; assignment engine always returns 4 non-seasonal bullets; seasonal injection deferred to theme (Phase 4)
10. ✅ Bestseller filter on products list (tag-based Shopify query)
11. ✅ "Regenerate Why People Love" button hidden when no alternatives exist (not just greyed out)

**Verify:** Swap Perfect For bullet → icon picker shows → new icon saved to metafield → renders in theme. Date range set → seasonal phrase included in preview.

### Phase 3 — Bulk assign + library browser + interest filters

1. ✅ `POST /api/bulk-assign` — SSE streaming; assigns WCT + PF + auto-generates Product Summary via Claude (option 1); skips products without type/style
2. ✅ `POST /api/bulk-classify` — SSE streaming; Claude infers PT Type + PT Style per product (~$0.002/product); streams results into review table
3. ✅ `POST /api/bulk-classify/save` — batch writes approved type+style metafields to Shopify after staff review
4. ✅ Bulk page (`/bulk`) — product table with checkboxes, select all, page size selector (10/25/50/100), type filter; "Classify Type & Style" opens review panel with product thumbnails (click to enlarge modal), type dropdowns, style checkboxes, skip toggles; "Populate Content" button gated to only process products that already have type+style set
5. ✅ `GET /api/products` extended with `limit` param for configurable page size
6. ✅ Live date config from settings store wired into `assignPerfectFor` (both preview and bulk-assign routes call `getSettings()`)
7. ⬜ Library browser (`/library`) with filters, tables, icon previews ← NEXT
8. ⬜ Interest-filter keyword map for ~17 filtered Perfect For entries

**Verify:** Select products without type/style → Classify → review table shows AI suggestions with thumbnails → approve → type/style saved. Then select those products → Populate Content → SSE shows progress → all have WCT + PF + Summary metafields.

### Phase 4 — Theme integration

1. ⬜ Update `product-why-people-love-this.liquid` — update 4 SVG icon definitions (sparkle/heart/shield/gift-with-heart per slot); switch bullet rendering to `innerHTML` via JavaScript for HTML metafield values
2. ⬜ Update `product-perfect-for.liquid` — remove keyword-matching icon logic; read `icon_1`–`icon_4` metafields; render as `<img>` if CDN URL, else inline SVG string
3. ⬜ Seasonal injection — at page load, read per-product seasonal override metafields and settings date window; if active, replace one random bullet with the seasonal phrase and icon (display only, no metafield writes)

**Verify:** Visit `?view=pdp-redesign` → all 3 content sections render; icons appear on Perfect For bullets; within a seasonal date window with override ticked, seasonal phrase replaces one bullet.

---

## Critical Reference Files

| Purpose | Path |
|---|---|
| Auth routes | `/Users/philippa/Projects/PT/Reorder Collections Tool/app/api/auth/` |
| shopify.ts source | `/Users/philippa/Projects/PT/Reorder Collections Tool/lib/shopify.ts` |
| next.config.ts source | `/Users/philippa/Projects/PT/Reorder Collections Tool/next.config.ts` |
| Why Choose This theme section | `/Users/philippa/Projects/PT/PDP Redesign/Shopify-Theme/sections/product-why-people-love-this.liquid` |
| Perfect For theme section | `/Users/philippa/Projects/PT/PDP Redesign/Shopify-Theme/sections/product-perfect-for.liquid` |
| PDP template | `/Users/philippa/Projects/PT/PDP Redesign/Shopify-Theme/templates/product.pdp-redesign.liquid` |
| Source Excel | `/Users/philippa/Projects/PT/PDP Content Management/Reasons to Buy.xlsx` |
| Brief | `/Users/philippa/Projects/PT/PDP Content Management/PDP Content Management Brief.docx` |
