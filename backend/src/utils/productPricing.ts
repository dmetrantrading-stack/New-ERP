/** Implied markup % from price and cost (matches ProductList UI logic). */
export function impliedMarkupPercent(price: number, cost: number): number | null {
  if (!cost || cost <= 0 || !price || price <= 0) return null;
  return Math.round(((price / cost) - 1) * 100 * 100) / 100;
}

export function priceFromMarkup(cost: number, markupPct: number): number {
  return Math.round(cost * (1 + markupPct / 100) * 100) / 100;
}

export function repriceFromCostChange(
  oldCost: number,
  newCost: number,
  retailPrice: number,
  wholesalePrice: number,
  distributorPrice: number,
): { retail_price?: number; wholesale_price?: number; distributor_price?: number } | null {
  if (!newCost || newCost <= 0) return null;
  const baseCost = oldCost > 0 ? oldCost : newCost;
  const rm = impliedMarkupPercent(retailPrice, baseCost);
  const wm = impliedMarkupPercent(wholesalePrice, baseCost);
  const dm = impliedMarkupPercent(distributorPrice, baseCost);
  const updates: { retail_price?: number; wholesale_price?: number; distributor_price?: number } = {};
  if (rm != null && rm > 0) updates.retail_price = priceFromMarkup(newCost, rm);
  if (wm != null && wm > 0) updates.wholesale_price = priceFromMarkup(newCost, wm);
  if (dm != null && dm > 0) updates.distributor_price = priceFromMarkup(newCost, dm);
  return Object.keys(updates).length > 0 ? updates : null;
}
