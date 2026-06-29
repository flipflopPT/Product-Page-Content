import type { WhyChooseThisEntry, PerfectForEntry } from "./types";

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface ProductContext {
  title: string;
  descriptionText: string;
  productType: string;
  productStyles: string[];
  price?: number;
}

export interface DateRangeConfig {
  mothersDay:    { start: string; end: string } | null;
  fathersDay:    { start: string; end: string } | null;
  valentinesDay: { start: string; end: string } | null;
}

export interface SeasonalOverrides {
  mothersDay:    boolean;
  fathersDay:    boolean;
  valentinesDay: boolean;
}

export interface AssignedWhyChooseThis {
  bullet1: string;
  bullet2: string;
  bullet3: string;
  bullet4: string;
}

export interface AssignedPerfectFor {
  bullets: string[];
  icons: string[];
}

export interface AssignedSeasonalPhrases {
  mothersDay:    { phrase: string; icon: string } | null;
  fathersDay:    { phrase: string; icon: string } | null;
  valentinesDay: { phrase: string; icon: string } | null;
}

const WCT_CATEGORIES = ["Stands Out", "Gift Impact", "Trusted Pick", "Worth Keeping"] as const;

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

export function assignWhyChooseThis(
  product: ProductContext,
  library: WhyChooseThisEntry[],
  seed?: number
): AssignedWhyChooseThis {
  const rand = seed !== undefined ? seededRandom(seed) : Math.random.bind(Math);
  const result: string[] = [];

  for (const category of WCT_CATEGORIES) {
    const candidates = library.filter(
      (e) =>
        e.productType === product.productType &&
        product.productStyles.includes(e.productStyle) &&
        e.category === category
    );

    if (candidates.length === 0) {
      result.push("");
    } else {
      const chosen = candidates[Math.floor(rand() * candidates.length)];
      result.push(`<strong>${escHtml(chosen.text)}</strong> ${escHtml(chosen.subtext)}`);
    }
  }

  return { bullet1: result[0], bullet2: result[1], bullet3: result[2], bullet4: result[3] };
}

function isWithinDateRange(today: Date, range: { start: string; end: string } | null): boolean {
  if (!range) return false;
  const t = today.toISOString().slice(0, 10);
  return t >= range.start && t <= range.end;
}

function timeSensitiveKey(ts: string | null): keyof DateRangeConfig | null {
  if (ts === "mothers-day") return "mothersDay";
  if (ts === "fathers-day") return "fathersDay";
  if (ts === "valentines-day") return "valentinesDay";
  return null;
}

function productMatchesInterest(
  entry: PerfectForEntry,
  product: ProductContext,
  interestKeywords: Record<string, string[]>
): boolean {
  const keywords = interestKeywords[entry.phrase];
  if (!keywords || keywords.length === 0) return true;
  const text = `${product.title} ${product.descriptionText}`.toLowerCase();
  return keywords.some((k) => text.includes(k.toLowerCase()));
}

const MUM_REGEX = /\b(mum|mums|mother|mothers)\b/i;
const DAD_REGEX = /\b(dad|dads|father|fathers)\b/i;

export function assignSeasonalPhrases(
  product: ProductContext,
  library: PerfectForEntry[],
  seed?: number,
  assignedBullets?: string[]
): AssignedSeasonalPhrases {
  const rand = seed !== undefined ? seededRandom(seed) : Math.random.bind(Math);
  const hasMum = assignedBullets?.some((b) => MUM_REGEX.test(b)) ?? false;
  const hasDad = assignedBullets?.some((b) => DAD_REGEX.test(b)) ?? false;

  function pickForSeason(key: "mothers-day" | "fathers-day" | "valentines-day"): { phrase: string; icon: string } | null {
    const candidates = library.filter((e) => {
      if (e.timeSensitive !== key) return false;
      const typeMatch  = e.productType  === "ALL" || e.productType  === product.productType;
      const styleMatch = e.productStyle === "ALL" || product.productStyles.includes(e.productStyle);
      return typeMatch && styleMatch;
    });
    if (candidates.length === 0) return null;
    // Sort descending by applicabilityCount so higher-specificity entries win,
    // then shuffle within the top tier to vary selection across equal candidates.
    candidates.sort((a, b) => (b.applicabilityCount ?? 0) - (a.applicabilityCount ?? 0));
    const topCount = candidates[0].applicabilityCount ?? 0;
    const topTier = candidates.filter((e) => (e.applicabilityCount ?? 0) === topCount);
    for (let i = topTier.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [topTier[i], topTier[j]] = [topTier[j], topTier[i]];
    }
    const chosen = topTier[0];
    return { phrase: chosen.phrase, icon: chosen.icon };
  }

  return {
    mothersDay:    hasMum ? null : pickForSeason("mothers-day"),
    fathersDay:    hasDad ? null : pickForSeason("fathers-day"),
    valentinesDay: pickForSeason("valentines-day"),
  };
}

export function debugPerfectForFilter(
  product: ProductContext,
  library: PerfectForEntry[],
  interestKeywords: Record<string, string[]> = {}
): { phrase: string; style: string; excluded: string | null }[] {
  return library
    .filter((e) => e.productType === "ALL" || e.productType === product.productType)
    .map((entry) => {
      if (entry.timeSensitive) return { phrase: entry.phrase, style: entry.productStyle, excluded: `seasonal (${entry.timeSensitive})` };
      const price = product.price ?? 0;
      if (entry.minPrice !== undefined && price > 0 && price < entry.minPrice) return { phrase: entry.phrase, style: entry.productStyle, excluded: `price ${price} below min ${entry.minPrice}` };
      if (entry.maxPrice !== undefined && price > 0 && price > entry.maxPrice) return { phrase: entry.phrase, style: entry.productStyle, excluded: `price ${price} above max ${entry.maxPrice}` };
      if (entry.filterByInterest && !productMatchesInterest(entry, product, interestKeywords)) return { phrase: entry.phrase, style: entry.productStyle, excluded: `interest filter (no keyword match)` };
      const typeMatch = entry.productType === "ALL" || entry.productType === product.productType;
      const styleMatch = entry.productStyle === "ALL" || product.productStyles.includes(entry.productStyle);
      if (!typeMatch) return { phrase: entry.phrase, style: entry.productStyle, excluded: `type mismatch (${entry.productType} vs ${product.productType})` };
      if (!styleMatch) return { phrase: entry.phrase, style: entry.productStyle, excluded: `style mismatch (${entry.productStyle} not in [${product.productStyles.join(",")}])` };
      return { phrase: entry.phrase, style: entry.productStyle, excluded: null };
    });
}

export function assignPerfectFor(
  product: ProductContext,
  library: PerfectForEntry[],
  dateConfig: DateRangeConfig,
  today: Date,
  seed?: number,
  seasonalOverrides?: SeasonalOverrides,
  interestKeywords: Record<string, string[]> = {}
): AssignedPerfectFor {
  const rand = seed !== undefined ? seededRandom(seed) : Math.random.bind(Math);

  // Step 1: filter — seasonal entries always excluded (stored separately; theme decides whether to display)
  const filtered = library.filter((entry) => {
    if (entry.timeSensitive) return false;
    const price = product.price ?? 0;
    if (entry.minPrice !== undefined && price > 0 && price < entry.minPrice) return false;
    if (entry.maxPrice !== undefined && price > 0 && price > entry.maxPrice) return false;
    if (entry.filterByInterest && !productMatchesInterest(entry, product, interestKeywords)) return false;
    const typeMatch = entry.productType === "ALL" || entry.productType === product.productType;
    const styleMatch = entry.productStyle === "ALL" || product.productStyles.includes(entry.productStyle);
    return typeMatch && styleMatch;
  });

  // Step 2a: deduplicate by phrase, keeping the most specific entry (non-ALL style wins)
  const phraseMap = new Map<string, PerfectForEntry>();
  for (const entry of filtered) {
    const existing = phraseMap.get(entry.phrase);
    if (!existing || (entry.productStyle !== "ALL" && existing.productStyle === "ALL")) {
      phraseMap.set(entry.phrase, entry);
    }
  }

  // Step 2b: shuffle candidates so within-tier selection varies across runs
  const candidates = [...phraseMap.values()];
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // Randomly decide whether to lead with specific or ALL phrases
  const prioritiseSpecific = rand() < 0.5;

  const sorted = [...candidates].sort((a, b) => {
    // Interest-matched phrases first (filterByInterest=true means matched, since non-matching were excluded in step 1)
    const aInterest = a.filterByInterest ? 0 : 1;
    const bInterest = b.filterByInterest ? 0 : 1;
    if (aInterest !== bInterest) return aInterest - bInterest;

    const aSpecific = a.productStyle !== "ALL" ? 0 : 1;
    const bSpecific = b.productStyle !== "ALL" ? 0 : 1;
    return prioritiseSpecific ? aSpecific - bSpecific : bSpecific - aSpecific;
  });

  // Step 3: pick 4 with category diversity and icon diversity
  const selected: PerfectForEntry[] = [];
  const categoryCounts: Record<string, number> = { Occasion: 0, Person: 0, Context: 0 };
  const selectedIcons = new Set<string>();
  const remaining = [...sorted];

  while (selected.length < 4 && remaining.length > 0) {
    const minCount = Math.min(...Object.values(categoryCounts));

    // Prefer: min-count category + new icon
    let idx = remaining.findIndex(
      (e) => (categoryCounts[e.category] ?? 0) === minCount && (!e.icon || !selectedIcons.has(e.icon))
    );

    // Fall back 1: any category + new icon (preserve icon diversity over category balance)
    if (idx < 0) {
      idx = remaining.findIndex((e) => !e.icon || !selectedIcons.has(e.icon));
    }

    // Fall back 2: min-count category, accepting a duplicate icon
    if (idx < 0) {
      idx = remaining.findIndex((e) => (categoryCounts[e.category] ?? 0) === minCount);
    }

    const pick = idx >= 0 ? remaining.splice(idx, 1)[0] : remaining.shift()!;
    selected.push(pick);
    if (pick.icon) selectedIcons.add(pick.icon);
    categoryCounts[pick.category] = (categoryCounts[pick.category] ?? 0) + 1;
  }

  // Shuffle final selection so interest-matched phrases don't always land in slot 1
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }

  return {
    bullets: selected.map((e) => e.phrase),
    icons: selected.map((e) => e.icon),
  };
}
