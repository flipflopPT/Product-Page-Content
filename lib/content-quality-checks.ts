export type CheckId =
  | "wear-language"
  | "occasion-missing-pf"
  | "missing-bullets"
  | "duplicate-icons"
  | "boring-summary"
  | "context-mismatch";

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

// Summary is supposed to be a single sentence — flag if it's very long or contains banned phrases
const BANNED_PHRASES = [
  "perfect gift", "thoughtful gift", "thoughtfully designed", "thoughtfully crafted",
  "sure to delight", "elevate your", "timeless", "make a statement",
  "look no further", "whether you're looking", "stands the test of time",
  "a must-have", "truly special", "ideal for", "loved by all",
  "without trying too hard",
];

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

  const lower = s.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      return {
        checkId: "boring-summary",
        label: "Clichéd summary",
        detail: `Summary contains "${phrase}"`,
        severity: "warning",
      };
    }
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

export function runNonAiChecks(row: QualityRow): QualityIssue[] {
  return [
    checkWearLanguage(row),
    checkOccasionMissingFromPF(row),
    checkMissingBullets(row),
    checkDuplicatePFIcons(row),
    checkBoringSummary(row),
  ].filter((issue): issue is QualityIssue => issue !== null);
}
