type MF = { value: string } | null;
type StatusValue = "complete" | "partial" | "missing";

export function classifyStatus(node: { productTypePt: MF; productStylePt: MF }): StatusValue {
  const hasType  = !!node.productTypePt?.value;
  const hasStyle = !!node.productStylePt?.value;
  if (hasType && hasStyle) return "complete";
  if (hasType || hasStyle)  return "partial";
  return "missing";
}

export function contentStatus(node: { productSummary: MF; wctBullet1: MF; pfBullet1: MF; seasonalMdPhrase: MF; seasonalFdPhrase: MF; seasonalVdPhrase: MF }): StatusValue {
  const summary = node.productSummary?.value ?? "";
  const wct = node.wctBullet1?.value ?? "";
  const pf = node.pfBullet1?.value ?? "";
  const seasonal = !!(node.seasonalMdPhrase?.value || node.seasonalFdPhrase?.value || node.seasonalVdPhrase?.value);
  if (summary && wct && pf) return "complete";
  if (summary || wct || pf || seasonal) return "partial";
  return "missing";
}

export function matchesFilter(filter: string, cs: StatusValue, contentSt: StatusValue): boolean {
  if (!filter) return true;
  if (filter === "needs-classify")    return cs !== "complete";
  if (filter === "ready-to-populate") return cs === "complete" && contentSt !== "complete";
  if (filter === "complete")          return contentSt === "complete";
  if (filter === "missing")     return contentSt === "missing";
  if (filter === "partial")     return contentSt === "partial";
  if (filter === "has-content")      return contentSt !== "missing";
  if (filter === "content-partial")  return contentSt === "partial";
  if (filter === "content-complete") return contentSt === "complete";
  return true;
}
