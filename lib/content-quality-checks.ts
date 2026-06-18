export type CheckId =
  | "wear-language"
  | "occasion-missing-pf"
  | "missing-bullets"
  | "duplicate-icons"
  | "boring-summary"
  | "context-mismatch"
  | "summary-rules"
  | "durability-claim";

export interface QualityIssue {
  checkId: CheckId;
  label: string;
  detail: string;
  severity: "error" | "warning";
  meta?: { duplicateIconPhrases?: Array<{ phrase: string; iconKey: string }> };
}

export interface QualityRow {
  productId: string;
  title: string;
  productTypePt: string;
  vendor?: string;
  summary: string;
  wctBullets: [string, string, string, string];
  pfBullets: [string, string, string, string];
  pfIcons: [string, string, string, string];
}

const WEARABLE_TYPES = new Set([
  "Women's Jewellery",
  "Children's Jewellery",
  "Men's Jewellery & Accessories",
  "Bags & Purses",
  "Personalised Accessories",
]);

const WEAR_REGEX = /\bwear(s|ing|able)?\b|\bworn\b/i;

const OCCASION_MAP: Array<{ titleWord: RegExp; pfMatch: RegExp; name: string }> = [
  { titleWord: /\bbirthday\b/i,    pfMatch: /birthday|birthdays|milestone/i,     name: "Birthday" },
  { titleWord: /\bwedding\b/i,     pfMatch: /wedding|bride|bridesmaid|groom/i,   name: "Wedding" },
  { titleWord: /\banniversary\b/i, pfMatch: /anniversar/i,                        name: "Anniversary" },
  { titleWord: /\bchristmas\b/i,   pfMatch: /christmas/i,                         name: "Christmas" },
  { titleWord: /\bgraduat/i,       pfMatch: /graduat/i,                           name: "Graduation" },
  { titleWord: /\bchristening\b/i, pfMatch: /christening|baptism/i,              name: "Christening" },
  { titleWord: /\bbaptism\b/i,     pfMatch: /baptism|christening/i,              name: "Baptism" },
  { titleWord: /\bretirement\b/i,  pfMatch: /retirement/i,                        name: "Retirement" },
  { titleWord: /\bvalentine/i,     pfMatch: /valentine/i,                         name: "Valentine's" },
  { titleWord: /\bnew baby\b|\bbaby shower\b/i, pfMatch: /baby|new arrival/i,    name: "New Baby" },
  { titleWord: /\bhen party\b|\bhen night\b|\bbachelorette\b/i, pfMatch: /\bhen\b|bachelorette/i, name: "Hen Party" },
];

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

export function canonicalIconKey(icon: string): string {
  if (!icon.trim()) return "";
  if (icon.startsWith("<svg")) {
    const idMatch = icon.match(/\bid="([^"]+)"/);
    if (idMatch) return idMatch[1];
    const dMatch = icon.match(/\bd="([^"]{8,})/);
    return dMatch ? `path:${dMatch[1].slice(0, 40)}` : `svg:${icon.length}`;
  }
  return icon.trim().toLowerCase();
}

function checkWearLanguage(row: QualityRow): QualityIssue | null {
  if (!row.productTypePt || WEARABLE_TYPES.has(row.productTypePt)) return null;

  const fields: Array<{ value: string; name: string }> = [
    { value: row.summary, name: "Summary" },
    ...row.wctBullets.map((b, i) => ({ value: stripHtml(b), name: `WCT bullet ${i + 1}` })),
    ...row.pfBullets.map((b, i) => ({ value: b, name: `PF phrase ${i + 1}` })),
  ];

  for (const { value, name } of fields) {
    if (value && WEAR_REGEX.test(value)) {
      return {
        checkId: "wear-language",
        label: "Wear language",
        detail: `${name} uses wear/wearing language for a ${row.productTypePt} product`,
        severity: "warning",
      };
    }
  }
  return null;
}

function checkOccasionMissingFromPF(row: QualityRow): QualityIssue | null {
  const nonEmptyPf = row.pfBullets.filter((b) => b.trim());
  if (nonEmptyPf.length === 0) return null;

  for (const { titleWord, pfMatch, name } of OCCASION_MAP) {
    if (titleWord.test(row.title)) {
      if (!nonEmptyPf.some((b) => pfMatch.test(b))) {
        return {
          checkId: "occasion-missing-pf",
          label: "Occasion not in PF",
          detail: `Title mentions "${name}" but no Perfect For phrase reflects it`,
          severity: "error",
        };
      }
    }
  }
  return null;
}

function checkMissingBullets(row: QualityRow): QualityIssue | null {
  const pfCount = row.pfBullets.filter((b) => b.trim()).length;
  const wctCount = row.wctBullets.filter((b) => stripHtml(b).trim()).length;

  if (pfCount < 4 || wctCount < 4) {
    return {
      checkId: "missing-bullets",
      label: "Missing bullets",
      detail: `${pfCount}/4 Perfect For, ${wctCount}/4 Why Choose`,
      severity: "error",
    };
  }
  return null;
}

const BANNED_SUMMARY_PHRASES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /perfect gift/i,           label: `contains banned phrase "perfect gift"` },
  { pattern: /thoughtful gift/i,        label: `contains banned phrase "thoughtful gift"` },
  { pattern: /loved by all/i,           label: `contains banned phrase "loved by all"` },
  { pattern: /deeply personal/i,        label: `contains banned phrase "deeply personal"` },
  { pattern: /deeply meaningful/i,      label: `contains banned phrase "deeply meaningful"` },
  { pattern: /tells a story/i,          label: `contains banned phrase "tells a story"` },
  { pattern: /comes gift.?wrapped/i,    label: `contains banned phrase "comes gift wrapped"` },
  { pattern: /arrives ready to give/i,  label: `contains banned phrase "arrives ready to give"` },
  { pattern: /without trying too hard/i,label: `contains banned phrase "without trying too hard"` },
  { pattern: /from every angle/i,       label: `contains banned phrase "from every angle"` },
  { pattern: /at first glance/i,        label: `contains banned phrase "at first glance"` },
];

const MUTED_WORDS: RegExp[] = [
  /\bquietly\b/i, /\bunderstated\b/i, /\bgently\b/i, /\bsoftly\b/i,
];

function checkSummaryRules(row: QualityRow): QualityIssue[] {
  const s = row.summary.trim();
  if (!s) return [];

  const violations: string[] = [];

  if (/[—–]/.test(s))                         violations.push("contains a dash (— or –)");
  if (/!/.test(s))                             violations.push("contains an exclamation mark");
  if (/\byou\b|\byour\b/i.test(s))            violations.push(`addresses the reader directly ("you"/"your")`);
  if (/\bshe\b|\bher\b|\bhe\b|\bhim\b/i.test(s)) violations.push("uses gendered pronoun (she/he/her/him) — use they/them");
  if (/\bsomeone\b/i.test(s))                 violations.push(`refers to the recipient as "someone"`);
  if (/\bwhoever\b/i.test(s))                 violations.push(`refers to the recipient as "whoever"`);
  if (/without being\b/i.test(s))             violations.push(`hedges with "without being"`);
  if (/without demanding/i.test(s))           violations.push(`hedges with "without demanding"`);
  if (/without overwhelming/i.test(s))        violations.push(`hedges with "without overwhelming"`);

  for (const { pattern, label } of BANNED_SUMMARY_PHRASES) {
    if (pattern.test(s)) violations.push(label);
  }

  for (const re of MUTED_WORDS) {
    const m = re.exec(s);
    if (m) violations.push(`uses muted word "${m[0].toLowerCase()}"`);
  }

  return violations.map((detail) => ({
    checkId: "summary-rules" as const,
    label: "Summary rule",
    detail,
    severity: "warning" as const,
  }));
}

const SUMMARY_MAX_CHARS = 220;

function checkBoringSummary(row: QualityRow): QualityIssue | null {
  const s = row.summary.trim();
  if (!s) return null;

  if (s.length > SUMMARY_MAX_CHARS) {
    return {
      checkId: "boring-summary",
      label: "Long summary",
      detail: `Summary is ${s.length} characters — should be a single concise sentence`,
      severity: "warning",
    };
  }

  return null;
}

function checkDuplicatePFIcons(row: QualityRow): QualityIssue | null {
  const items = row.pfBullets.map((phrase, i) => ({
    phrase,
    iconKey: canonicalIconKey(row.pfIcons[i]),
  })).filter((item) => item.iconKey);

  if (items.length < 2) return null;

  const groups = new Map<string, Array<{ phrase: string; iconKey: string }>>();
  for (const item of items) {
    if (!groups.has(item.iconKey)) groups.set(item.iconKey, []);
    groups.get(item.iconKey)!.push(item);
  }

  const duplicated = [...groups.values()].filter((g) => g.length > 1).flat();
  if (duplicated.length === 0) return null;

  return {
    checkId: "duplicate-icons",
    label: "Duplicate icons",
    detail: "Same Perfect For icon used more than once",
    severity: "warning",
    meta: { duplicateIconPhrases: duplicated },
  };
}

const JEWELLERY_TYPES = new Set([
  "Women's Jewellery",
  "Children's Jewellery",
  "Men's Jewellery & Accessories",
]);

const DURABILITY_REGEX = /\blast(s|ed|ing)?\s+for\s+years?\b|\bfor\s+years?\s+to\s+come\b|\bstand\s+the\s+test\s+of\s+time\b|\bbuilt?\s+to\s+last\b|\bmade\s+to\s+last\b|\blong[- ]lasting\b|\bdurabl(e|ility)\b/i;

function checkDurabilityLanguage(row: QualityRow): QualityIssue | null {
  if (!JEWELLERY_TYPES.has(row.productTypePt)) return null;
  if (row.vendor === "Reeves & Reeves") return null;

  const fields: Array<{ value: string; name: string }> = [
    { value: row.summary, name: "Summary" },
    ...row.wctBullets.map((b, i) => ({ value: stripHtml(b), name: `WCT bullet ${i + 1}` })),
  ];

  for (const { value, name } of fields) {
    if (value && DURABILITY_REGEX.test(value)) {
      return {
        checkId: "durability-claim",
        label: "Durability claim",
        detail: `${name} makes a durability or longevity claim — verify this is accurate for this product`,
        severity: "warning",
      };
    }
  }
  return null;
}

export function runNonAiChecks(row: QualityRow): QualityIssue[] {
  return [
    checkWearLanguage(row),
    checkOccasionMissingFromPF(row),
    checkMissingBullets(row),
    checkDuplicatePFIcons(row),
    checkBoringSummary(row),
    checkDurabilityLanguage(row),
    ...checkSummaryRules(row),
  ].filter((issue): issue is QualityIssue => issue !== null);
}
