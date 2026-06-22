import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../config/database';
import { ACCOUNT_BY_ID_SQL } from './bankCashBalance';

const EXCLUDED_TYPES = new Set(['Checks on Hand', 'Petty Cash Fund', 'Clearing']);

export function isStartingBalanceEligible(row: {
  id?: number | string;
  account_type?: string;
  primary_cash_on_hand_id?: number | null;
}): boolean {
  const type = row.account_type || '';
  if (EXCLUDED_TYPES.has(type)) return false;
  if (type === 'Cash on Hand') {
    return row.primary_cash_on_hand_id != null && Number(row.id) === Number(row.primary_cash_on_hand_id);
  }
  return type !== 'Cash on Hand';
}

async function generateRefNumber(prefix: string, table: string, field: string): Promise<string> {
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeField = field.replace(/[^a-z_]/g, '');
  const safePrefix = prefix.replace(/[^A-Z0-9]/g, '');
  const startPos = safePrefix.length + 2;
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeField} FROM ${startPos}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeField} ~ $1`,
    [`^${safePrefix}-`],
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
}

async function generateJENumber(): Promise<string> {
  const result = await query(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'",
  );
  return `JE-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
}

async function countNonOpeningActivity(
  accountId: number,
  accountType: string,
  openingRefId: string | null,
): Promise<number> {
  if (accountType === 'Cash on Hand') {
    const r = await query(
      `SELECT COUNT(*)::int AS cnt FROM cash_transactions ct
       WHERE (ct.status IS NULL OR ct.status != 'Void')
         AND ($1::uuid IS NULL OR ct.id != $1::uuid)`,
      [openingRefId],
    );
    return r.rows[0]?.cnt || 0;
  }
  const r = await query(
    `SELECT COUNT(*)::int AS cnt FROM bank_transactions bt
     WHERE bt.bank_account_id = $1
       AND ($2::uuid IS NULL OR bt.id != $2::uuid)`,
    [accountId, openingRefId],
  );
  return r.rows[0]?.cnt || 0;
}

async function voidOpeningRecords(
  client: Awaited<ReturnType<typeof getClient>>,
  account: { id: number; account_type?: string; starting_balance_ref_id?: string | null },
) {
  const refId = account.starting_balance_ref_id;
  if (!refId) return;

  await client.query(
    `UPDATE journal_entries SET status = 'Void', updated_at = CURRENT_TIMESTAMP
     WHERE reference_id = $1 AND reference_type = 'Opening Balance' AND status = 'Posted'`,
    [refId],
  );

  if (account.account_type === 'Cash on Hand') {
    await client.query(
      `UPDATE cash_transactions SET status = 'Void'
       WHERE id = $1 AND (status IS NULL OR status != 'Void')`,
      [refId],
    );
    return;
  }

  const bt = await client.query('SELECT * FROM bank_transactions WHERE id = $1', [refId]);
  if (bt.rows.length > 0) {
    const row = bt.rows[0];
    await client.query(
      `UPDATE bank_accounts SET balance = balance - (CASE WHEN $1='Deposit' THEN $2::decimal ELSE -($2::decimal) END), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [row.transaction_type, row.amount, row.bank_account_id],
    );
    await client.query('DELETE FROM bank_transactions WHERE id = $1', [refId]);
  }
}

export async function setAccountStartingBalance(
  accountId: number,
  amount: number,
  userId: string,
  options?: { notes?: string; entry_date?: string },
) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Amount must be zero or greater');
  }

  const acctResult = await query(ACCOUNT_BY_ID_SQL, [accountId]);
  if (acctResult.rows.length === 0) throw new Error('Account not found');
  const account = acctResult.rows[0];

  if (!isStartingBalanceEligible(account)) {
    throw new Error('Starting balance is not supported for this account type');
  }

  const accountType = account.account_type || '';
  const existingRef = account.starting_balance_ref_id as string | null;
  const otherActivity = await countNonOpeningActivity(account.id, accountType, existingRef);
  if (otherActivity > 0 && parseFloat(String(account.starting_balance || 0)) !== amount) {
    throw new Error('Cannot change starting balance after other transactions have been posted on this account');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (existingRef) {
      await voidOpeningRecords(client, account);
    }

    if (amount <= 0) {
      await client.query(
        `UPDATE bank_accounts SET starting_balance = 0, starting_balance_ref_id = NULL, starting_balance_set_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [accountId],
      );
      await client.query('COMMIT');
      return { starting_balance: 0, cleared: true };
    }

    const entryDate = options?.entry_date || new Date().toISOString().slice(0, 10);
    const label = `${account.bank_name} — ${account.account_name}`;
    const notes = options?.notes?.trim() || `Starting balance — ${label}`;
    const refId = uuidv4();
    const entryId = uuidv4();
    const entryNumber = await generateJENumber();

    if (accountType === 'Cash on Hand') {
      const txnNumber = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
      await client.query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1,$2,'Opening',$3,'Opening Balance',$1,$4,$5)`,
        [refId, txnNumber, amount, notes, userId],
      );
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
         VALUES ($1,$2,$3,'Opening Balance',$4,$5,$6,$6,$7)`,
        [entryId, entryNumber, entryDate, refId, notes, amount, userId],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$3,$4,0,'Opening Balance',$5),
                ($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3000'),$7,0,$4,'Opening Balance',$5)`,
        [uuidv4(), entryId, notes, amount, refId, uuidv4(), notes],
      );
    } else {
      const bankGlCode = account.gl_account_code || '1010';
      await client.query(
        `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by)
         VALUES ($1,$2,'Deposit',$3,$4,'Opening Balance',$1,$5,$6)`,
        [refId, accountId, amount, entryDate, notes, userId],
      );
      await client.query(
        `UPDATE bank_accounts SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [amount, accountId],
      );
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
         VALUES ($1,$2,$3,'Opening Balance',$4,$5,$6,$6,$7)`,
        [entryId, entryNumber, entryDate, refId, notes, amount, userId],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Opening Balance',$6),
                ($7,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3000'),$8,0,$5,'Opening Balance',$6)`,
        [uuidv4(), entryId, bankGlCode, notes, amount, refId, uuidv4(), notes],
      );
    }

    await client.query(
      `UPDATE bank_accounts SET starting_balance = $1, starting_balance_ref_id = $2, starting_balance_set_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [amount, refId, accountId],
    );

    await client.query('COMMIT');
    return { starting_balance: amount, entry_number: entryNumber, reference_id: refId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
