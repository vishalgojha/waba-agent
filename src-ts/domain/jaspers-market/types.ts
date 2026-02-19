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
  recipientNote?: string;
  quoteTotalInr?: number;
  checkoutConfirmed?: boolean;
}

export interface MarketPlan {
  stage: MarketSession["stage"];
  risk: "LOW" | "MEDIUM" | "HIGH";
  replyText: string;
  nextSession: MarketSession;
  recommendations: MarketProduct[];
}
