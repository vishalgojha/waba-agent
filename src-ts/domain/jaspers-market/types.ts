// src-ts/domain/jaspers-market/types.ts
export interface MarketProduct {
  code: string;
  name: string;
  category: "bouquet" | "gift_box" | "cake" | "addon";
  priceInr: number;
  tags: string[];
}

export interface MarketSession {
  phone: string;
  updatedAt: string;
  stage: "new" | "menu" | "qualified" | "selected" | "checkout";
  occasion?: string;
  budgetMaxInr?: number;
  selectedProductCode?: string;
}

export interface MarketPlan {
  stage: MarketSession["stage"];
  replyText: string;
  nextSession: MarketSession;
  recommendations: MarketProduct[];
}
