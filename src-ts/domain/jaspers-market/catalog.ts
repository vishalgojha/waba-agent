// src-ts/domain/jaspers-market/catalog.ts
import type { MarketProduct } from "./types.js";

export const JASPERS_CATALOG: MarketProduct[] = [
  { code: "P1", name: "Rose Bouquet Classic", category: "bouquet", priceInr: 799, tags: ["romantic", "birthday", "anniversary"] },
  { code: "P2", name: "Lily Celebration Bouquet", category: "bouquet", priceInr: 1199, tags: ["premium", "anniversary", "congrats"] },
  { code: "P3", name: "Chocolate Gift Box", category: "gift_box", priceInr: 999, tags: ["birthday", "thank-you", "corporate"] },
  { code: "P4", name: "Mini Photo Cake", category: "cake", priceInr: 699, tags: ["birthday", "party", "kids"] },
  { code: "P5", name: "Luxury Gift Hamper", category: "gift_box", priceInr: 1999, tags: ["premium", "wedding", "festive"] },
  { code: "P6", name: "Greeting Card Add-on", category: "addon", priceInr: 149, tags: ["addon", "message"] }
];
