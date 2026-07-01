export type LoyaltyRates = {
  enabled: boolean;
  earnPesoPerPoint: number;
  pesoPerPoint: number;
};

export const DEFAULT_LOYALTY_RATES: LoyaltyRates = {
  enabled: true,
  earnPesoPerPoint: 1,
  pesoPerPoint: 1,
};

export function loyaltyRatesFromApi(data: any): LoyaltyRates {
  return {
    enabled: data?.enabled !== false,
    earnPesoPerPoint: Math.max(0.01, parseFloat(String(data?.earn_peso_per_point ?? 1)) || 1),
    pesoPerPoint: Math.max(0.01, parseFloat(String(data?.redeem_peso_per_point ?? 1)) || 1),
  };
}

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

export function formatLoyaltyEarnLabel(rates: LoyaltyRates): string {
  const n = rates.earnPesoPerPoint;
  if (n === 1) return 'Earn 1 point per ₱1 spent';
  if (Number.isInteger(n)) return `Earn 1 point per ₱${n} spent`;
  return `Earn 1 point per ₱${n.toFixed(2)} spent`;
}

export function formatLoyaltyRedeemLabel(rates: LoyaltyRates): string {
  const n = rates.pesoPerPoint;
  if (n === 1) return 'Redeem 1 point = ₱1 off';
  if (Number.isInteger(n)) return `Redeem 1 point = ₱${n} off`;
  return `Redeem 1 point = ₱${n.toFixed(2)} off`;
}
