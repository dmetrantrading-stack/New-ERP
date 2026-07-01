/** Contra-revenue GL account for loyalty redemptions at POS. */

export const LOYALTY_DISCOUNT_GL_ACCOUNT = '4050';



export type LoyaltyRates = {

  enabled: boolean;

  /** Peso spend required to earn 1 point (e.g. 100 = ₱100 per point). */

  earnPesoPerPoint: number;

  /** Peso discount value of 1 point when redeemed (e.g. 1 = ₱1 off). */

  pesoPerPoint: number;

};



export const DEFAULT_LOYALTY_RATES: LoyaltyRates = {

  enabled: true,

  earnPesoPerPoint: 1,

  pesoPerPoint: 1,

};



export function pointsEarnedForSale(netPeso: number, rates: LoyaltyRates = DEFAULT_LOYALTY_RATES): number {

  if (!rates.enabled) return 0;

  const unit = Math.max(0.01, rates.earnPesoPerPoint);

  return Math.floor(Math.max(0, netPeso) / unit);

}



export function pesoDiscountFromPoints(points: number, rates: LoyaltyRates = DEFAULT_LOYALTY_RATES): number {

  const pts = Math.max(0, Math.floor(points));

  return Math.round(pts * Math.max(0.01, rates.pesoPerPoint) * 100) / 100;

}



export function maxRedeemablePoints(

  balance: number,

  saleTotal: number,

  rates: LoyaltyRates = DEFAULT_LOYALTY_RATES,

): number {

  if (!rates.enabled) return 0;

  const bal = Math.max(0, Math.floor(balance));

  const pesoPerPt = Math.max(0.01, rates.pesoPerPoint);

  const cap = Math.floor(Math.max(0, saleTotal) / pesoPerPt);

  return Math.min(bal, cap);

}


