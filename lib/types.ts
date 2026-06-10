export interface WhyChooseThisEntry {
  id: string;
  productType: string;
  productStyle: string;
  category: "Stands Out" | "Gift Impact" | "Trusted Pick" | "Worth Keeping";
  text: string;
  subtext: string;
}

// Phrase definition — one per unique phrase text
export interface PFPhrase {
  id: string;
  phrase: string;
  icon: string;
  category: "Occasion" | "Person" | "Context";
  timeSensitive: "mothers-day" | "fathers-day" | "valentines-day" | null;
  filterByInterest: boolean;
}

// Applicability row — one per phrase × product-type/style combination
export interface PFApplicability {
  id: string;
  phraseId: string;
  productType: string;
  productStyle: string;
  applicabilityCount: number;
}

// Flat joined view — used everywhere outside the library management layer
export interface PerfectForEntry {
  id: string;       // applicability ID
  phraseId: string;
  productType: string;
  productStyle: string;
  category: "Occasion" | "Person" | "Context";
  phrase: string;
  filterByInterest: boolean;
  timeSensitive: "mothers-day" | "fathers-day" | "valentines-day" | null;
  applicabilityCount: number;
  icon: string;
}

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  featuredImage: string | null;
  productTypePt: string;
  productStylePt: string;
  classifyStatus: "complete" | "partial" | "missing";
  contentStatus: "complete" | "partial" | "missing";
  isChristmas: boolean;
  humanReviewed?: boolean;
}

export interface AppSettings {
  dateRanges: {
    mothersDay:    { start: string; end: string } | null;
    fathersDay:    { start: string; end: string } | null;
    valentinesDay: { start: string; end: string } | null;
  };
  interestKeywords: Record<string, string[]>;
}
