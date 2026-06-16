// Pure merge functions for the base-JSON → metaobject library migration.
// Extracted from migrate-library-to-metaobject.mjs so the merge logic can be
// unit-tested without touching the filesystem, env vars, or the network.
// See tests/unit/migrate-library-merge.test.ts.

/** @returns {Record<string, any>} */
export function mergeWct(wctBase, existingWct) {
  /** @type {Record<string, any>} */
  const merged = {};
  for (const base of wctBase) {
    const edit = existingWct[base.id];
    merged[base.id] = edit
      ? { ...edit, isNew: false }
      : {
          id: base.id,
          productType: base.productType,
          productStyle: base.productStyle,
          category: base.category,
          text: base.text,
          subtext: base.subtext,
          searchFormatted: "",
          isNew: false,
        };
  }
  for (const edit of Object.values(existingWct)) {
    if (edit.isNew) merged[edit.id] = edit;
  }
  return merged;
}

/** @returns {Record<string, any>} */
export function mergePfPhrases(pfPhrasesBase, existingPfPhrases) {
  /** @type {Record<string, any>} */
  const merged = {};
  for (const base of pfPhrasesBase) {
    const edit = existingPfPhrases[base.id];
    const entry = {
      id: base.id,
      phrase: edit?.phrase ?? base.phrase,
      icon: edit?.icon ?? base.icon,
      searchPhrase: edit?.searchPhrase ?? base.phrase,
      isNew: false,
      category: edit?.category ?? base.category,
      timeSensitive: edit?.timeSensitive !== undefined ? edit.timeSensitive : (base.timeSensitive ?? null),
      filterByInterest: edit?.filterByInterest !== undefined ? edit.filterByInterest : (base.filterByInterest ?? false),
    };
    const minPrice = edit?.minPrice !== undefined ? edit.minPrice : base.minPrice;
    const maxPrice = edit?.maxPrice !== undefined ? edit.maxPrice : base.maxPrice;
    if (minPrice != null) entry.minPrice = minPrice;
    if (maxPrice != null) entry.maxPrice = maxPrice;
    if (edit?.deleted) entry.deleted = true;
    merged[base.id] = entry;
  }
  for (const edit of Object.values(existingPfPhrases)) {
    if (edit.isNew) merged[edit.id] = edit;
  }
  return merged;
}

/** @returns {Record<string, any>} */
export function mergePfApplicability(pfApplicabilityBase, existingPfApplicability) {
  /** @type {Record<string, any>} */
  const merged = {};
  for (const base of pfApplicabilityBase) {
    const edit = existingPfApplicability[base.id];
    merged[base.id] = edit
      ? { ...edit, isNew: false }
      : {
          id: base.id,
          phraseId: base.phraseId,
          productType: base.productType,
          productStyle: base.productStyle,
          applicabilityCount: base.applicabilityCount,
          isNew: false,
        };
  }
  for (const edit of Object.values(existingPfApplicability)) {
    if (edit.isNew) merged[edit.id] = edit;
  }
  return merged;
}
