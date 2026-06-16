import { getLibraryEdits } from "./library-edits-store";
import type { WhyChooseThisEntry } from "./types";

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
