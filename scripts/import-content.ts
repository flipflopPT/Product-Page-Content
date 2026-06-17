/**
 * One-off script: converts Reasons to Buy.xlsx → data/why-choose-this.json + data/perfect-for.json
 * Run: npx tsx scripts/import-content.ts "./Reasons to Buy.xlsx"
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const WHY_CATEGORIES = ["Stands Out", "Gift Impact", "Trusted Pick", "Worth Keeping"] as const;
const TIME_SENSITIVE_PATTERNS: Record<string, string> = {
  "mother": "mothers-day",
  "father": "fathers-day",
  "valentine": "valentines-day",
};

// Map phrase keywords → icon name. Checked in order; first match wins.
const PERFECT_FOR_ICON_MAP: [RegExp, string][] = [
  [/birthday|cake/i,              "cake"],
  [/christmas|xmas/i,             "gift"],
  [/valentine|love|anniversary|romantic/i, "heart"],
  [/mother|mum|mom/i,             "flower"],
  [/father|dad/i,                 "star"],
  [/wedding|bride|bridesmaid|groom/i, "rings"],
  [/baby|christening|naming|new parent/i, "baby"],
  [/graduation|achievement|special/i, "graduate"],
  [/thank|appreciation|showing/i, "hand-heart"],
  [/home|housewarming|new home|renovation/i, "house"],
  [/dinner|host|party|entertain/i, "dining"],
  [/travel|holiday/i,             "plane"],
  [/book|read/i,                  "book"],
  [/music/i,                      "music"],
  [/sport|outdoor/i,              "trophy"],
  [/craft|creative|art/i,         "brush"],
  [/garden|plant|nature/i,        "leaf"],
  [/food|cook|foodie/i,           "fork"],
  [/colleague|corporate|work/i,   "briefcase"],
  [/teacher/i,                    "pencil"],
  [/teen|child|kid|girl|boy/i,    "star"],
  [/minimal|style|fashion/i,      "sparkle"],
  [/good luck|retirement|milestone/i, "ribbon"],
];

function pickIcon(phrase: string): string {
  for (const [pattern, icon] of PERFECT_FOR_ICON_MAP) {
    if (pattern.test(phrase)) return icon;
  }
  return "gift";
}

function detectTimeSensitive(phrase: string): string | null {
  const lower = phrase.toLowerCase();
  for (const [keyword, value] of Object.entries(TIME_SENSITIVE_PATTERNS)) {
    if (lower.includes(keyword)) return value;
  }
  return null;
}

// Build a map of all valid (type, style) combos from taxonomy.ts
const TAXONOMY: Record<string, string[]> = {
  "Bags & Purses":                 ["Elegant", "Personalised", "Practical", "Bold/Colourful"],
  "Home":                          ["Bold/Colourful", "Classic/Timeless", "Earthy/Natural", "Minimal", "Playful", "EcoFriendly"],
  "Women's Jewellery":             ["Dainty", "Minimal", "Personalised", "Statement"],
  "Children's Jewellery":          ["Dainty", "Minimal", "Personalised"],
  "Men's Jewellery & Accessories": ["Classic", "Modern", "Personalised"],
  "Children":                      ["Classic/Timeless", "Playful", "Creative"],
  "Books & Stationery":            ["Illustrated Books", "Inspirational", "Practical"],
  "Personalised Accessories":      ["Classic", "Novelty"],
  "Candles / Diffusers":           ["Novelty", "Premium"],
  "Greetings Cards":               ["Nature", "Novelty/Humorous"],
  "Fairy Lights":                  ["Minimal", "Decorative", "Colourful"],
  "Furniture & Lighting":          ["Minimal", "Scandi", "Statement", "Contemporary Classic"],
  "Christmas Themed Products":     ["Traditional", "Minimal", "Novelty"],
};

const ALL_COMBOS: Array<[string, string]> = [];
for (const [type, styles] of Object.entries(TAXONOMY)) {
  for (const style of styles) {
    ALL_COMBOS.push([type, style]);
  }
}

function computeApplicabilityCount(entryType: string, entryStyle: string): number {
  if (entryType === "ALL" && entryStyle === "ALL") return ALL_COMBOS.length;
  if (entryType === "ALL") return ALL_COMBOS.filter(([, s]) => s === entryStyle).length;
  if (entryStyle === "ALL") return (TAXONOMY[entryType] ?? []).length;
  return 1;
}

function normaliseCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-content.ts <path-to-xlsx>");
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const dataDir = path.join(process.cwd(), "data");

  // ─── Why Choose This ────────────────────────────────────────────────────────
  const wctSheet = wb.Sheets["Why Choose This"];
  if (!wctSheet) {
    console.error('Sheet "Why Choose This" not found. Available sheets:', wb.SheetNames.join(", "));
    process.exit(1);
  }
  const wctRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wctSheet, { defval: "" });

  const wctEntries = wctRows
    .map((row, i) => {
      // Detect column names from the first non-empty row
      const keys = Object.keys(row);
      const productType = normaliseCell(row[keys[0]] ?? row["Product Type"]);
      const productStyle = normaliseCell(row[keys[1]] ?? row["Product Style"]);
      const category = normaliseCell(row[keys[2]] ?? row["Callout Category"]);
      const text = normaliseCell(row[keys[3]] ?? row["Text"]);
      const subtext = normaliseCell(row[keys[4]] ?? row["Subtext"]);

      if (!productType || !category || !text) return null;
      if (!(WHY_CATEGORIES as readonly string[]).includes(category)) {
        console.warn(`Row ${i + 2}: unknown category "${category}" — skipped`);
        return null;
      }

      return {
        id: `wct-${String(i + 1).padStart(3, "0")}`,
        productType,
        productStyle,
        category,
        text,
        subtext,
      };
    })
    .filter(Boolean);

  fs.writeFileSync(
    path.join(dataDir, "why-choose-this.json"),
    JSON.stringify(wctEntries, null, 2)
  );
  console.log(`✓ why-choose-this.json — ${wctEntries.length} entries`);

  // ─── Perfect For ────────────────────────────────────────────────────────────
  const pfSheet = wb.Sheets["Perfect For"];
  if (!pfSheet) {
    console.error('Sheet "Perfect For" not found. Available sheets:', wb.SheetNames.join(", "));
    process.exit(1);
  }
  const pfRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(pfSheet, { defval: "" });

  const pfEntries = pfRows
    .map((row, i) => {
      const keys = Object.keys(row);
      const productType = normaliseCell(row[keys[0]] ?? row["Product Type"]);
      const productStyle = normaliseCell(row[keys[1]] ?? row["Style"]);
      const category = normaliseCell(row[keys[2]] ?? row["Category"]);
      const phrase = normaliseCell(row[keys[3]] ?? row["Perfect For Phrase"]);
      const filterRaw = normaliseCell(row[keys[4]] ?? row["Filter By Interest"]);

      if (!phrase) return null;

      const filterByInterest = filterRaw.toUpperCase() === "Y";
      const timeSensitive = detectTimeSensitive(phrase);
      const applicabilityCount = computeApplicabilityCount(productType || "ALL", productStyle || "ALL");

      return {
        id: `pf-${String(i + 1).padStart(3, "0")}`,
        productType: productType || "ALL",
        productStyle: productStyle || "ALL",
        category: category || "Occasion",
        phrase,
        filterByInterest,
        timeSensitive,
        applicabilityCount,
        icon: pickIcon(phrase),
      };
    })
    .filter(Boolean);

  fs.writeFileSync(
    path.join(dataDir, "perfect-for.json"),
    JSON.stringify(pfEntries, null, 2)
  );
  console.log(`✓ perfect-for.json — ${pfEntries.length} entries`);
}

main();
