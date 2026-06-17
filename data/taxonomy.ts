export const PRODUCT_TAXONOMY: Record<string, string[]> = {
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
};

export const PRODUCT_TYPES = Object.keys(PRODUCT_TAXONOMY);

export function getValidStyles(type: string): string[] {
  return PRODUCT_TAXONOMY[type] ?? [];
}

export function isValidCombination(type: string, style: string): boolean {
  return PRODUCT_TAXONOMY[type]?.includes(style) ?? false;
}
