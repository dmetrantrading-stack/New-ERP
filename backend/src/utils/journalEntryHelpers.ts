import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

export async function generateJENumber(): Promise<string> {
  const result = await query(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'",
  );
  return `JE-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
}

type QueryFn = typeof query;

/** Dr Cash on Hand / Cr Owner's Capital — same pattern as Bank & Cash cash-in. */
export async function postCashInJournal(
  db: QueryFn,
  opts: { referenceId: string; description: string; amount: number; userId: string; entryDate?: string },
) {
  const { referenceId, description, amount, userId, entryDate } = opts;
  const entryId = uuidv4();
  const entryNumber = await generateJENumber();
  await db(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1,$2,COALESCE($7::date, CURRENT_DATE),'Cash In',$3,$4,$5,$5,$6)`,
    [entryId, entryNumber, referenceId, description, amount, userId, entryDate || null],
  );
  await db(
    `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
     VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$3,$4,0,'Cash In',$5),
            ($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3000'),$7,0,$4,'Cash In',$5)`,
    [uuidv4(), entryId, description, amount, referenceId, uuidv4(), description],
  );
  return { entryId, entryNumber };
}

/** Dr Owner's Drawings / Cr Cash on Hand — same pattern as Bank & Cash cash-out. */
export async function postCashOutJournal(
  db: QueryFn,
  opts: { referenceId: string; description: string; amount: number; userId: string; entryDate?: string },
) {
  const { referenceId, description, amount, userId, entryDate } = opts;
  const entryId = uuidv4();
  const entryNumber = await generateJENumber();
  await db(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1,$2,COALESCE($7::date, CURRENT_DATE),'Cash Out',$3,$4,$5,$5,$6)`,
    [entryId, entryNumber, referenceId, description, amount, userId, entryDate || null],
  );
  await db(
    `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
     VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3010'),$3,$4,0,'Cash Out',$5),
            ($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$7,0,$4,'Cash Out',$5)`,
    [uuidv4(), entryId, description, amount, referenceId, uuidv4(), description],
  );
  return { entryId, entryNumber };
}

/** Post inventory variance journal (net increase → Dr Inventory / Cr 5020). */
export async function postInventoryVarianceJournal(
  db: QueryFn,
  opts: { referenceType: string; referenceId: string; description: string; netVariance: number; userId: string },
) {
  const { referenceType, referenceId, description, netVariance, userId } = opts;
  const amount = Math.abs(netVariance);
  if (amount <= 0) return null;

  const entryId = uuidv4();
  const entryNumber = await generateJENumber();
  await db(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$6,$7)`,
    [entryId, entryNumber, referenceType, referenceId, description, amount, userId],
  );

  const invAccount = await db("SELECT id FROM chart_of_accounts WHERE account_code = '1200'");
  const adjAccount = await db("SELECT id FROM chart_of_accounts WHERE account_code = '5020'");
  if (invAccount.rows.length === 0 || adjAccount.rows.length === 0) return { entryId, entryNumber };

  if (netVariance > 0) {
    await db(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7),
              ($8,$2,$9,$10,0,$5,$6,$7)`,
      [
        uuidv4(), entryId, invAccount.rows[0].id, 'Inventory increase', amount, referenceType, referenceId,
        uuidv4(), adjAccount.rows[0].id, 'Inventory adjustment offset',
      ],
    );
  } else {
    await db(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7),
              ($8,$2,$9,$10,0,$5,$6,$7)`,
      [
        uuidv4(), entryId, adjAccount.rows[0].id, 'Inventory decrease', amount, referenceType, referenceId,
        uuidv4(), invAccount.rows[0].id, 'Inventory decrease offset',
      ],
    );
  }
  return { entryId, entryNumber };
}
