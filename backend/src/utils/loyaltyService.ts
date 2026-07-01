import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  LOYALTY_DISCOUNT_GL_ACCOUNT,
  LoyaltyRates,
  maxRedeemablePoints,
  pesoDiscountFromPoints,
  pointsEarnedForSale,
} from './loyaltyPolicy';
import { getLoyaltySettings } from './loyaltySettings';

export async function getCustomerLoyaltyBalance(client: PoolClient, customerId: number): Promise<number> {
  const res = await client.query('SELECT loyalty_points FROM customers WHERE id = $1', [customerId]);
  return Math.max(0, parseInt(res.rows[0]?.loyalty_points || '0', 10) || 0);
}

export async function recordLoyaltyLedger(
  client: PoolClient,
  opts: {
    customerId: number;
    pointsChange: number;
    balanceAfter: number;
    reason: string;
    posTransactionId?: string;
    createdBy?: string;
  },
) {
  await client.query(
    `INSERT INTO customer_loyalty_ledger
      (id, customer_id, pos_transaction_id, points_change, balance_after, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uuidv4(),
      opts.customerId,
      opts.posTransactionId || null,
      opts.pointsChange,
      opts.balanceAfter,
      opts.reason,
      opts.createdBy || null,
    ],
  );
}

export async function applyLoyaltyOnPosSale(
  client: PoolClient,
  opts: {
    customerId: number;
    saleTotalBeforeLoyalty: number;
    requestedRedeemPoints: number;
    posTransactionId: string;
    createdBy?: string;
    rates?: LoyaltyRates;
  },
): Promise<{ pointsRedeemed: number; loyaltyDiscount: number; pointsEarned: number; finalTotal: number }> {
  const rates = opts.rates ?? await getLoyaltySettings(client);
  if (!rates.enabled) {
    return {
      pointsRedeemed: 0,
      loyaltyDiscount: 0,
      pointsEarned: 0,
      finalTotal: opts.saleTotalBeforeLoyalty,
    };
  }

  const balance = await getCustomerLoyaltyBalance(client, opts.customerId);
  const pointsRedeemed = Math.min(
    Math.max(0, Math.floor(opts.requestedRedeemPoints)),
    maxRedeemablePoints(balance, opts.saleTotalBeforeLoyalty, rates),
  );
  const loyaltyDiscount = pesoDiscountFromPoints(pointsRedeemed, rates);
  const finalTotal = Math.max(0, opts.saleTotalBeforeLoyalty - loyaltyDiscount);
  const pointsEarned = pointsEarnedForSale(finalTotal, rates);
  const netChange = pointsEarned - pointsRedeemed;
  const balanceAfter = Math.max(0, balance + netChange);

  await client.query(
    'UPDATE customers SET loyalty_points = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [balanceAfter, opts.customerId],
  );

  if (pointsRedeemed > 0) {
    await recordLoyaltyLedger(client, {
      customerId: opts.customerId,
      pointsChange: -pointsRedeemed,
      balanceAfter: Math.max(0, balance - pointsRedeemed),
      reason: 'POS redeem',
      posTransactionId: opts.posTransactionId,
      createdBy: opts.createdBy,
    });
  }
  if (pointsEarned > 0) {
    await recordLoyaltyLedger(client, {
      customerId: opts.customerId,
      pointsChange: pointsEarned,
      balanceAfter,
      reason: 'POS earn',
      posTransactionId: opts.posTransactionId,
      createdBy: opts.createdBy,
    });
  }

  return { pointsRedeemed, loyaltyDiscount, pointsEarned, finalTotal };
}

export async function insertLoyaltyDiscountGlLine(
  client: PoolClient,
  opts: {
    entryId: string;
    amount: number;
    debit: number;
    credit: number;
    referenceType: string;
    referenceId: string;
    description: string;
  },
) {
  const amt = Math.round(opts.amount * 100) / 100;
  if (amt <= 0) return;
  await client.query(
    `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
     VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, $6, $7, $8)`,
    [
      uuidv4(),
      opts.entryId,
      LOYALTY_DISCOUNT_GL_ACCOUNT,
      opts.description,
      opts.debit,
      opts.credit,
      opts.referenceType,
      opts.referenceId,
    ],
  );
}

export function loyaltyDiscountPortion(returnLineTotal: number, grossItemTotal: number, loyaltyDiscount: number): number {
  if (grossItemTotal <= 0 || loyaltyDiscount <= 0 || returnLineTotal <= 0) return 0;
  return Math.round((returnLineTotal / grossItemTotal) * loyaltyDiscount * 100) / 100;
}

export async function applyLoyaltyOnPosReturn(
  client: PoolClient,
  opts: {
    customerId: number;
    pointsEarned: number;
    pointsRedeemed: number;
    returnAmount: number;
    grossItemTotal: number;
    posTransactionId: string;
    returnId: string;
    createdBy?: string;
  },
): Promise<{ earnClawback: number; redeemRestore: number }> {
  const gross = Math.max(0, opts.grossItemTotal);
  const returned = Math.max(0, opts.returnAmount);
  if (gross <= 0 || returned <= 0) return { earnClawback: 0, redeemRestore: 0 };

  const fraction = Math.min(1, returned / gross);
  const earnClawback = Math.floor(Math.max(0, opts.pointsEarned) * fraction);
  const redeemRestore = Math.floor(Math.max(0, opts.pointsRedeemed) * fraction);
  const netChange = redeemRestore - earnClawback;
  if (netChange === 0) return { earnClawback, redeemRestore };

  const balance = await getCustomerLoyaltyBalance(client, opts.customerId);
  const balanceAfter = Math.max(0, balance + netChange);
  await client.query(
    'UPDATE customers SET loyalty_points = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [balanceAfter, opts.customerId],
  );
  await recordLoyaltyLedger(client, {
    customerId: opts.customerId,
    pointsChange: netChange,
    balanceAfter,
    reason: 'POS return adjustment',
    posTransactionId: opts.posTransactionId,
    createdBy: opts.createdBy,
  });

  return { earnClawback, redeemRestore };
}

export async function adjustCustomerLoyaltyManual(
  client: PoolClient,
  opts: {
    customerId: number;
    newBalance: number;
    createdBy?: string;
  },
): Promise<number> {
  const balance = await getCustomerLoyaltyBalance(client, opts.customerId);
  const target = Math.max(0, Math.floor(opts.newBalance));
  const change = target - balance;
  if (change === 0) return balance;

  await client.query(
    'UPDATE customers SET loyalty_points = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [target, opts.customerId],
  );
  await recordLoyaltyLedger(client, {
    customerId: opts.customerId,
    pointsChange: change,
    balanceAfter: target,
    reason: 'Manual adjustment',
    createdBy: opts.createdBy,
  });
  return target;
}

export async function reverseLoyaltyOnPosVoid(
  client: PoolClient,
  opts: {
    customerId: number;
    pointsEarned: number;
    pointsRedeemed: number;
    posTransactionId: string;
    createdBy?: string;
  },
) {
  const earned = Math.max(0, Math.floor(opts.pointsEarned));
  const redeemed = Math.max(0, Math.floor(opts.pointsRedeemed));
  if (earned === 0 && redeemed === 0) return;

  const balance = await getCustomerLoyaltyBalance(client, opts.customerId);
  const balanceAfter = Math.max(0, balance - earned + redeemed);
  await client.query(
    'UPDATE customers SET loyalty_points = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [balanceAfter, opts.customerId],
  );
  await recordLoyaltyLedger(client, {
    customerId: opts.customerId,
    pointsChange: -earned + redeemed,
    balanceAfter,
    reason: 'POS void reversal',
    posTransactionId: opts.posTransactionId,
    createdBy: opts.createdBy,
  });
}
