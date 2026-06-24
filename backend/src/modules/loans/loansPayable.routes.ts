import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';
import { assertPeriodNotLocked } from '../../utils/periodLock';
import { resolveAccountGlCode } from '../../utils/bankCashOperations';

const router = Router();

const LOANS_PAYABLE_CODE = '2200';
const INTEREST_EXPENSE_CODE = '6130';
const CASH_CODE = '1000';

const loansView = hasUserPerm('finance.loans.view');
const loansCreate = hasUserPerm('finance.loans.create');
const loansEdit = hasUserPerm('finance.loans.edit');

const nextNumber = async (prefix: string, table: string, field: string, startPos: number) => {
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeField = field.replace(/[^a-z_]/g, '');
  const safePrefix = prefix.replace(/[^A-Z0-9]/g, '');
  const r = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeField} FROM ${startPos}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeField} ~ '^${safePrefix}-'`,
  );
  return `${safePrefix}-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

const nextJeNumber = async () => nextNumber('JE', 'journal_entries', 'entry_number', 4);

const roundMoney = (n: number) => Math.round(n * 100) / 100;

const createJournalEntry = async (
  entryDate: string | Date,
  refType: string,
  refId: string,
  description: string,
  lines: { accountCode: string; description: string; debit: number; credit: number }[],
  userId: string,
) => {
  const entryId = uuidv4();
  const entryNumber = await nextJeNumber();
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new AppError('Journal entry is not balanced');
  }

  await query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1, $2, $3::date, $4, $5::uuid, $6, $7, $8, $9::uuid)`,
    [entryId, entryNumber, entryDate, refType, refId, description, totalDebit, totalCredit, userId],
  );

  for (const line of lines) {
    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3::varchar), $4, $5, $6, $7, $8::uuid)`,
      [uuidv4(), entryId, line.accountCode, line.description, line.debit, line.credit, refType, refId],
    );
  }

  return entryId;
};

const nextCtNumber = async () => {
  const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_number, 4) AS INTEGER)), 0) + 1 as next FROM cash_transactions WHERE transaction_number ~ '^CT-[0-9]+$'");
  return `CT-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

const resolveBankGlCode = async (bankAccountId?: number | null) => {
  if (!bankAccountId) return '1010';
  const bank = await query('SELECT account_type, gl_account_code FROM bank_accounts WHERE id = $1', [bankAccountId]);
  if (bank.rows.length === 0) return '1010';
  return resolveAccountGlCode(bank.rows[0]);
};

const recordCashIn = async (amount: number, refType: string, refId: string, notes: string, userId: string) => {
  await query(
    `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, 'Cash In', $3, $4, $5, $6, $7)`,
    [uuidv4(), await nextCtNumber(), amount, refType, refId, notes, userId],
  );
};

const recordBankDeposit = async (bankAccountId: number, amount: number, refType: string, refId: string, notes: string, userId: string) => {
  await query(
    `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, 'Deposit', $3, CURRENT_DATE, $4, $5, $6, $7)`,
    [uuidv4(), bankAccountId, amount, refType, refId, notes, userId],
  );
  await query(`UPDATE bank_accounts SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [amount, bankAccountId]);
};

const recordCashOut = async (amount: number, refType: string, refId: string, notes: string, userId: string) => {
  await query(
    `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, 'Cash Out', $3, $4, $5, $6, $7)`,
    [uuidv4(), await nextCtNumber(), amount, refType, refId, notes, userId],
  );
};

const recordBankWithdrawal = async (bankAccountId: number, amount: number, refType: string, refId: string, notes: string, userId: string) => {
  await query(
    `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, 'Withdrawal', $3, CURRENT_DATE, $4, $5, $6, $7)`,
    [uuidv4(), bankAccountId, amount, refType, refId, notes, userId],
  );
  await query(`UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [amount, bankAccountId]);
};

const computeMonthlyInterest = (principal: number, rateMonthly: number) =>
  roundMoney(principal * (rateMonthly / 100));

const getLoanOrThrow = async (id: string) => {
  const r = await query('SELECT * FROM loans_payable WHERE id = $1', [id]);
  if (r.rows.length === 0) throw new AppError('Loan not found', 404);
  return r.rows[0];
};

router.get('/', authenticate, loansView, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT lp.*,
        (lp.outstanding_principal + lp.accrued_interest_balance) as total_outstanding
       FROM loans_payable lp
       ORDER BY lp.loan_date DESC, lp.created_at DESC`,
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/interest-preview', authenticate, loansView, async (req: AuthRequest, res: Response) => {
  try {
    const loan = await getLoanOrThrow(req.params.id);
    if (loan.status !== 'Active') throw new AppError('Loan is not active');
    const principal = parseFloat(loan.outstanding_principal);
    const rate = parseFloat(loan.interest_rate_monthly);
    const interest = computeMonthlyInterest(principal, rate);
    res.json({
      outstanding_principal: principal,
      accrued_interest_balance: parseFloat(loan.accrued_interest_balance),
      interest_rate_monthly: rate,
      suggested_interest: interest,
      total_outstanding: roundMoney(principal + parseFloat(loan.accrued_interest_balance)),
    });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, loansView, async (req: AuthRequest, res: Response) => {
  try {
    const loan = await getLoanOrThrow(req.params.id);
    const txns = await query(
      `SELECT * FROM loan_payable_transactions WHERE loan_id = $1 ORDER BY txn_date ASC, created_at ASC`,
      [req.params.id],
    );
    res.json({
      ...loan,
      total_outstanding: roundMoney(parseFloat(loan.outstanding_principal) + parseFloat(loan.accrued_interest_balance)),
      transactions: txns.rows,
    });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.post('/', authenticate, loansCreate, auditLog('Loans Payable', 'Create Loan'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      lender_name,
      lender_type,
      loan_date,
      maturity_date,
      principal_amount,
      interest_rate_monthly,
      deposit_account_type,
      deposit_bank_account_id,
      notes,
    } = req.body;

    const amount = roundMoney(parseFloat(String(principal_amount)));
    const rate = parseFloat(String(interest_rate_monthly || 0));
    if (!lender_name?.trim()) throw new AppError('Lender name is required');
    if (!amount || amount <= 0) throw new AppError('Valid principal amount is required');
    if (rate < 0) throw new AppError('Interest rate cannot be negative');

    const acctType = deposit_account_type === 'cash' ? 'cash' : 'bank';
    if (acctType === 'bank' && !deposit_bank_account_id) {
      throw new AppError('Bank account is required when deposit goes to bank');
    }

    const loanDate = loan_date || new Date().toISOString().slice(0, 10);
    await assertPeriodNotLocked(loanDate);

    const id = uuidv4();
    const loanNumber = await nextNumber('LP', 'loans_payable', 'loan_number', 4);

    await query(
      `INSERT INTO loans_payable (id, loan_number, lender_name, lender_type, loan_date, maturity_date,
        principal_amount, outstanding_principal, interest_rate_monthly, deposit_account_type, deposit_bank_account_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12)`,
      [
        id, loanNumber, lender_name.trim(), lender_type || 'Bank', loanDate, maturity_date || null,
        amount, rate, acctType, deposit_bank_account_id || null, notes || null, req.user!.id,
      ],
    );

    await query(
      `INSERT INTO loan_payable_transactions (id, loan_id, txn_type, txn_date, amount, principal_component, notes, created_by)
       VALUES ($1,$2,'Disbursement',$3,$4,$4,$5,$6)`,
      [uuidv4(), id, loanDate, amount, notes || `Loan proceeds from ${lender_name}`, req.user!.id],
    );

    const depositGl = acctType === 'bank'
      ? await resolveBankGlCode(deposit_bank_account_id)
      : CASH_CODE;

    await createJournalEntry(
      loanDate,
      'Loan Payable',
      id,
      `Loan received ${loanNumber} — ${lender_name}`,
      [
        { accountCode: depositGl, description: 'Loan proceeds received', debit: amount, credit: 0 },
        { accountCode: LOANS_PAYABLE_CODE, description: 'Loan liability', debit: 0, credit: amount },
      ],
      req.user!.id,
    );

    if (acctType === 'bank') {
      await recordBankDeposit(deposit_bank_account_id, amount, 'Loan Payable', id, `Loan ${loanNumber}`, req.user!.id);
    } else {
      await recordCashIn(amount, 'Loan Payable', id, `Loan ${loanNumber}`, req.user!.id);
    }

    res.status(201).json({ id, loan_number: loanNumber });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.post('/:id/accrue-interest', authenticate, loansCreate, auditLog('Loans Payable', 'Accrue Interest'), async (req: AuthRequest, res: Response) => {
  try {
    const loan = await getLoanOrThrow(req.params.id);
    if (loan.status !== 'Active') throw new AppError('Loan is not active');

    const principal = parseFloat(loan.outstanding_principal);
    if (principal <= 0) throw new AppError('No outstanding principal to accrue interest on');

    const rate = parseFloat(loan.interest_rate_monthly);
    if (rate <= 0) throw new AppError('Set a monthly interest rate on this loan first');

    const accrualDate = req.body.accrual_date || new Date().toISOString().slice(0, 10);
    await assertPeriodNotLocked(accrualDate);

    let interest = req.body.amount != null && req.body.amount !== ''
      ? roundMoney(parseFloat(String(req.body.amount)))
      : computeMonthlyInterest(principal, rate);

    if (!interest || interest <= 0) throw new AppError('Interest amount must be greater than zero');

    const txnId = uuidv4();
    await query(
      `INSERT INTO loan_payable_transactions (id, loan_id, txn_type, txn_date, amount, interest_component, notes, created_by)
       VALUES ($1,$2,'Interest Accrual',$3,$4,$4,$5,$6)`,
      [txnId, loan.id, accrualDate, interest, req.body.notes || `Monthly interest @ ${rate}%`, req.user!.id],
    );

    await query(
      `UPDATE loans_payable SET accrued_interest_balance = accrued_interest_balance + $1,
        last_interest_accrual_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [interest, accrualDate, loan.id],
    );

    await createJournalEntry(
      accrualDate,
      'Loan Interest',
      txnId,
      `Interest accrual ${loan.loan_number}`,
      [
        { accountCode: INTEREST_EXPENSE_CODE, description: 'Interest expense', debit: interest, credit: 0 },
        { accountCode: LOANS_PAYABLE_CODE, description: 'Accrued loan interest', debit: 0, credit: interest },
      ],
      req.user!.id,
    );

    res.json({ message: 'Interest accrued', interest_amount: interest });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.post('/:id/payments', authenticate, loansCreate, auditLog('Loans Payable', 'Loan Payment'), async (req: AuthRequest, res: Response) => {
  try {
    const loan = await getLoanOrThrow(req.params.id);
    if (loan.status !== 'Active') throw new AppError('Loan is not active');

    const totalAmount = roundMoney(parseFloat(String(req.body.total_amount)));
    if (!totalAmount || totalAmount <= 0) throw new AppError('Valid payment amount is required');

    const paymentDate = req.body.payment_date || new Date().toISOString().slice(0, 10);
    await assertPeriodNotLocked(paymentDate);

    const paymentAccountType = req.body.payment_account_type === 'cash' ? 'cash' : 'bank';
    const paymentBankAccountId = req.body.payment_bank_account_id || null;
    if (paymentAccountType === 'bank' && !paymentBankAccountId) {
      throw new AppError('Bank account is required for bank payment');
    }

    let interestBal = parseFloat(loan.accrued_interest_balance);
    let principalBal = parseFloat(loan.outstanding_principal);
    const totalDue = roundMoney(interestBal + principalBal);
    if (totalAmount > totalDue + 0.01) {
      throw new AppError(`Payment exceeds total outstanding (${totalDue.toFixed(2)})`);
    }

    const interestPaid = roundMoney(Math.min(totalAmount, interestBal));
    const principalPaid = roundMoney(totalAmount - interestPaid);

    const txnId = uuidv4();
    await query(
      `INSERT INTO loan_payable_transactions (id, loan_id, txn_type, txn_date, amount, principal_component, interest_component,
        payment_account_type, payment_bank_account_id, notes, created_by)
       VALUES ($1,$2,'Payment',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        txnId, loan.id, paymentDate, totalAmount, principalPaid, interestPaid,
        paymentAccountType, paymentBankAccountId, req.body.notes || 'Loan payment', req.user!.id,
      ],
    );

    interestBal = roundMoney(interestBal - interestPaid);
    principalBal = roundMoney(principalBal - principalPaid);
    const newStatus = interestBal <= 0 && principalBal <= 0 ? 'Paid Off' : 'Active';

    await query(
      `UPDATE loans_payable SET outstanding_principal = $1, accrued_interest_balance = $2,
        status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [principalBal, interestBal, newStatus, loan.id],
    );

    const creditGl = paymentAccountType === 'bank'
      ? await resolveBankGlCode(paymentBankAccountId)
      : CASH_CODE;

    await createJournalEntry(
      paymentDate,
      'Loan Payment',
      txnId,
      `Loan payment ${loan.loan_number}`,
      [
        { accountCode: LOANS_PAYABLE_CODE, description: 'Loan principal + interest payment', debit: totalAmount, credit: 0 },
        { accountCode: creditGl, description: 'Cash/bank disbursement', debit: 0, credit: totalAmount },
      ],
      req.user!.id,
    );

    if (paymentAccountType === 'bank') {
      await recordBankWithdrawal(paymentBankAccountId, totalAmount, 'Loan Payment', txnId, `Loan ${loan.loan_number}`, req.user!.id);
    } else {
      await recordCashOut(totalAmount, 'Loan Payment', txnId, `Loan ${loan.loan_number}`, req.user!.id);
    }

    res.json({
      message: 'Payment recorded',
      principal_paid: principalPaid,
      interest_paid: interestPaid,
      status: newStatus,
    });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.put('/:id/cancel', authenticate, loansEdit, auditLog('Loans Payable', 'Cancel Loan'), async (req: AuthRequest, res: Response) => {
  try {
    const loan = await getLoanOrThrow(req.params.id);
    if (loan.status !== 'Active') throw new AppError('Only active loans can be cancelled');

    const otherTxns = await query(
      `SELECT COUNT(*)::int as c FROM loan_payable_transactions WHERE loan_id = $1 AND txn_type != 'Disbursement'`,
      [loan.id],
    );
    if (otherTxns.rows[0].c > 0) {
      throw new AppError('Cannot cancel a loan that already has payments or interest accruals');
    }

    const amount = parseFloat(loan.principal_amount);
    const depositGl = loan.deposit_account_type === 'bank'
      ? await resolveBankGlCode(loan.deposit_bank_account_id)
      : CASH_CODE;

    await createJournalEntry(
      new Date(),
      'Loan Payable Cancel',
      loan.id,
      `Cancel loan ${loan.loan_number}`,
      [
        { accountCode: LOANS_PAYABLE_CODE, description: 'Reverse loan liability', debit: amount, credit: 0 },
        { accountCode: depositGl, description: 'Reverse loan proceeds', debit: 0, credit: amount },
      ],
      req.user!.id,
    );

    await query(
      `UPDATE loans_payable SET status = 'Cancelled', outstanding_principal = 0, accrued_interest_balance = 0,
        updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [loan.id],
    );

    if (loan.deposit_account_type === 'bank' && loan.deposit_bank_account_id) {
      await recordBankWithdrawal(
        loan.deposit_bank_account_id,
        amount,
        'Loan Payable Cancel',
        loan.id,
        `Reverse loan ${loan.loan_number}`,
        req.user!.id,
      );
    } else {
      await recordCashOut(amount, 'Loan Payable Cancel', loan.id, `Reverse loan ${loan.loan_number}`, req.user!.id);
    }

    res.json({ message: 'Loan cancelled' });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

export default router;
