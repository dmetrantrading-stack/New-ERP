import React, { useState, useEffect, useCallback, useRef } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate, parseNumericField, parseIntegerField } from '../../lib/utils';
import { PRIMARY, FINANCE_FONT, financeTabClass } from '../../lib/financeUtils';
import { useAuth } from '../../store/auth';
import {
  Plus, Edit2, DollarSign, FileText, X, Wallet, ShoppingCart,
  CheckCircle, XCircle, Shield, UserCheck, CreditCard, Printer,
  Briefcase, RefreshCw, Eye, ArrowLeft, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { canAccessHrTab } from '../../lib/hrPermissions';
import { printDocument, printFromIframe } from '../../lib/printDocument';

const employeeName = (e: any) => `${e.last_name}, ${e.first_name}${e.middle_name ? ' ' + e.middle_name.charAt(0) + '.' : ''}`;

const toLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    Active: 'bg-green-100 text-green-700', 'Fully Paid': 'bg-green-100 text-green-700',
    Draft: 'bg-gray-100 text-gray-600', Posted: 'bg-blue-100 text-blue-700',
    Paid: 'bg-green-100 text-green-700', Cancelled: 'bg-red-100 text-red-700',
    Deducted: 'bg-purple-100 text-purple-700', Approved: 'bg-blue-100 text-blue-700',
    Present: 'bg-green-100 text-green-700', Late: 'bg-yellow-100 text-yellow-700',
    Absent: 'bg-red-100 text-red-700', 'Half-day': 'bg-orange-100 text-orange-700',
    Leave: 'bg-blue-100 text-blue-700',
    'Rest Day': 'bg-gray-200 text-gray-600',
  };
  return `px-2 py-1 text-xs rounded-full ${map[s] || 'bg-gray-100 text-gray-600'}`;
};

export default function HrPage() {
  const { hasPerm, hasAnyPerm } = useAuth();
  const canEmpCreate = hasPerm('hr.employees.create');
  const canEmpEdit = hasPerm('hr.employees.edit');
  const canCaCreate = hasPerm('hr.cash-advances.create');
  const canCaEdit = hasPerm('hr.cash-advances.edit');
  const canPayrollCreate = hasPerm('hr.payroll.create');
  const canPayrollApprove = hasPerm('hr.payroll.approve');
  const canPayrollEdit = hasPerm('hr.payroll.edit');
  const canPayrollPrint = hasPerm('hr.payroll.print') || hasPerm('hr.payslip.print');
  const canAttendanceEdit = hasPerm('hr.attendance.create');
  const canAttendancePrint = hasPerm('hr.attendance.print');

  const allTabs = [
    { key: 'employees', label: 'Employees', icon: UserCheck },
    { key: 'cash-advances', label: 'Cash Advances', icon: Wallet },
    { key: 'grocery', label: 'Grocery Credits', icon: ShoppingCart },
    { key: 'attendance-sheet', label: 'Attendance Sheet', icon: FileText },
    { key: 'payroll', label: 'Payroll', icon: DollarSign },
    { key: 'sss', label: 'SSS', icon: Shield },
  ] as const;

  const tabs = allTabs.filter((t) => canAccessHrTab(hasAnyPerm, t.key));

  const [activeTab, setActiveTab] = useState(() => tabs[0]?.key || 'employees');
  const [employees, setEmployees] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [cashAdvances, setCashAdvances] = useState<any[]>([]);
  const [groceryCredits, setGroceryCredits] = useState<any[]>([]);
  const [sssContributions, setSssContributions] = useState<any[]>([]);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [viewingPayroll, setViewingPayroll] = useState<any | null>(null);
  const [viewingPayrollRegister, setViewingPayrollRegister] = useState<{ from: string; to: string } | null>(null);
  const [viewingSssRegister, setViewingSssRegister] = useState<{ from: string; to: string } | null>(null);
  const payrollPreviewRef = useRef<HTMLIFrameElement>(null);
  const payrollRegisterPreviewRef = useRef<HTMLIFrameElement>(null);
  const sssRegisterPreviewRef = useRef<HTMLIFrameElement>(null);

  // Modals
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [showCashAdvModal, setShowCashAdvModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showSssModal, setShowSssModal] = useState(false);
  const [showSssPayModal, setShowSssPayModal] = useState(false);
  const [selectedSssId, setSelectedSssId] = useState<string | null>(null);
  const [showGcDetailModal, setShowGcDetailModal] = useState(false);
  const [gcDetail, setGcDetail] = useState<any>(null);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPayrollId, setSelectedPayrollId] = useState<string | null>(null);

  // Attendance Sheet state
  const [sheetData, setSheetData] = useState<any>(null);
  const today = new Date();
  const isSecondHalf = today.getDate() >= 16;
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const [sheetFrom, setSheetFrom] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth(), isSecondHalf ? 16 : 1)));
  const [sheetTo, setSheetTo] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth(), isSecondHalf ? lastDayOfMonth : 15)));
  const [registerFrom, setRegisterFrom] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth(), isSecondHalf ? 16 : 1)));
  const [registerTo, setRegisterTo] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth(), isSecondHalf ? lastDayOfMonth : 15)));
  const [sssRegisterFrom, setSssRegisterFrom] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [sssRegisterTo, setSssRegisterTo] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [sheetEmployeeId, setSheetEmployeeId] = useState('');
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetChanges, setSheetChanges] = useState<Record<string, string>>({});

  const [editEmployee, setEditEmployee] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [empForm, setEmpForm] = useState<any>({ first_name: '', last_name: '', position: '', department: '', daily_rate: '', monthly_rate: '', phone: '', email: '', sss: '', philhealth: '', pagibig: '', tin: '', employment_type: 'Regular', hire_date: '', credit_limit: '', sss_default_amount: '' });
  const [payrollForm, setPayrollForm] = useState<any>({ employee_id: '', pay_period_start: '', pay_period_end: '', days_worked: '', other_deductions: [] });
  const [showBatchPayrollModal, setShowBatchPayrollModal] = useState(false);
  const [batchPeriod, setBatchPeriod] = useState({ pay_period_start: '', pay_period_end: '' });
  const [batchPreviewRows, setBatchPreviewRows] = useState<any[]>([]);
  const [batchPreviewLoading, setBatchPreviewLoading] = useState(false);
  const [batchCreating, setBatchCreating] = useState(false);
  const batchPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cashAdvForm, setCashAdvForm] = useState<any>({ employee_id: '', amount: '', payment_account_type: 'cash', notes: '', installment_amount: '', installment_count: '' });
  const [sssForm, setSssForm] = useState<any>({ employee_id: '', period_start: '', period_end: '', employer_amount: '', employee_amount: '', notes: '' });
  const [payAccount, setPayAccount] = useState({ payment_account_type: 'cash', payment_account_id: '', payment_date: '', reference_number: '' });
  const [sssPayAccount, setSssPayAccount] = useState({ payment_account_type: 'cash', payment_account_id: '' });

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === activeTab)) {
      setActiveTab(tabs[0].key);
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    if (hasPerm('hr.employees.view')) {
      api.get('/hr/employees').then((res) => setEmployees(res.data)).catch(() => {});
    }
    api.get('/bank-cash/accounts/all').then((res) => setBankAccounts(res.data)).catch(() => {});
  }, [hasPerm]);

  const loadSheet = useCallback(() => {
    setSheetChanges({});
    const from = new Date(sheetFrom);
    const endDate = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    if (new Date(sheetTo) > endDate) setSheetTo(toLocalDate(endDate));
    const params = `from=${sheetFrom}&to=${sheetTo}${sheetEmployeeId ? '&employee_id=' + sheetEmployeeId : ''}`;
    api.get('/hr/attendance/sheet?' + params).then(r => setSheetData(r.data)).catch(() => {});
  }, [sheetFrom, sheetTo, sheetEmployeeId]);

  useEffect(() => {
    const tab = activeTab;
    if (tab === 'payroll') { api.get('/hr/payroll').then((r) => setPayroll(r.data)).catch(() => {}); }
    if (tab === 'cash-advances') { api.get('/hr/cash-advances').then((r) => setCashAdvances(r.data)).catch(() => {}); }
    if (tab === 'grocery') { api.get('/hr/grocery-credits').then((r) => setGroceryCredits(r.data)).catch(() => {}); }
    if (tab === 'sss') { api.get('/hr/sss-contributions').then((r) => setSssContributions(r.data)).catch(() => {}); }
    if (tab === 'attendance-sheet') { loadSheet(); }
  }, [activeTab, loadSheet]);

  const toggleSheetStatus = (empId: string, date: string, current: string | null) => {
    const cycle = !current ? 'Present' : current === 'Present' ? 'Absent' : current === 'Absent' ? 'Late' : current === 'Late' ? 'Half-day' : current === 'Half-day' ? 'Leave' : current === 'Leave' ? 'Rest Day' : null;
    const key = `${empId}_${date}`;
    setSheetChanges(prev => ({ ...prev, [key]: cycle || '' }));
    setSheetData((prev: any) => {
      if (!prev) return prev;
      const updated = { ...prev, employees: prev.employees.map((e: any) => {
        if (String(e.id) !== String(empId)) return e;
        const newDays = { ...e.days, [date]: { ...e.days[date], status: cycle } };
        const summary: Record<string, number> = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, rest_day: 0, worked: 0 };
        for (const dt of prev.dates) {
          const rec = newDays[dt];
          if (rec?.status) {
            const s = rec.status.toLowerCase();
            if (s === 'present') { summary.present++; summary.worked++; }
            else if (s === 'absent') summary.absent++;
            else if (s === 'late') { summary.late++; summary.worked++; }
            else if (s === 'half-day') { summary.half_day++; summary.worked += 0.5; }
            else if (s === 'leave') summary.leave++;
            else if (s === 'rest day') summary.rest_day++;
          }
        }
        return { ...e, days: newDays, summary };
      }) };
      return updated;
    });
  };

  const saveSheet = async () => {
    const entries: any[] = [];
    if (!sheetData) return;
    for (const e of sheetData.employees) {
      for (const dt of sheetData.dates) {
        const key = `${e.id}_${dt}`;
        if (sheetChanges[key] !== undefined) {
          entries.push({ employee_id: e.id, date: dt, status: sheetChanges[key] || null });
        }
      }
    }
    if (entries.length === 0) { toast.error('No changes to save'); return; }
    setSheetSaving(true);
    try {
      await api.post('/hr/attendance/sheet', { entries });
      toast.success(`${entries.length} entries saved`);
      setSheetChanges({});
      loadSheet();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
    finally { setSheetSaving(false); }
  };

  const refreshAll = () => {
    api.get('/hr/employees').then((res) => setEmployees(res.data)).catch(() => {});
    api.get('/hr/payroll').then((r) => setPayroll(r.data)).catch(() => {});
    api.get('/hr/cash-advances').then((r) => setCashAdvances(r.data)).catch(() => {});
    api.get('/hr/grocery-credits').then((r) => setGroceryCredits(r.data)).catch(() => {});
    api.get('/hr/sss-contributions').then((r) => setSssContributions(r.data)).catch(() => {});
  };

  // === EMPLOYEES ===
  const openCreateEmployee = () => {
    setEditEmployee(null);
    setEmpForm({ first_name: '', last_name: '', position: '', department: '', daily_rate: '', monthly_rate: '', phone: '', email: '', sss: '', philhealth: '', pagibig: '', tin: '', employment_type: 'Regular', hire_date: '', credit_limit: '', sss_default_amount: '' });
    setShowEmployeeModal(true);
  };
  const openEditEmployee = (e: any) => { setEditEmployee(e); setEmpForm(e); setShowEmployeeModal(true); };

  const saveEmployee = async () => {
    const payload = {
      ...empForm,
      daily_rate: parseNumericField(empForm.daily_rate),
      monthly_rate: parseNumericField(empForm.monthly_rate),
      credit_limit: parseNumericField(empForm.credit_limit),
      sss_default_amount: parseNumericField(empForm.sss_default_amount),
    };
    try {
      if (editEmployee) { await api.put(`/hr/employees/${editEmployee.id}`, payload); toast.success('Updated'); }
      else { await api.post('/hr/employees', payload); toast.success('Created'); }
      setShowEmployeeModal(false);
      api.get('/hr/employees').then((res) => setEmployees(res.data));
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const viewLedger = async (id: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/hr/employees/${id}/ledger`);
      setLedgerData(res.data);
      setShowLedgerModal(true);
    } catch (err: any) { toast.error('Failed to load ledger'); }
    finally { setLoading(false); }
  };

  // === CASH ADVANCES ===
  const openCashAdv = () => {
    setCashAdvForm({ employee_id: '', amount: '', payment_account_type: 'cash', notes: '', installment_amount: '', installment_count: '' });
    setShowCashAdvModal(true);
  };
  const saveCashAdv = async () => {
    const payload = {
      ...cashAdvForm,
      amount: parseNumericField(cashAdvForm.amount),
      installment_amount: parseNumericField(cashAdvForm.installment_amount),
      installment_count: parseIntegerField(cashAdvForm.installment_count),
    };
    try {
      await api.post('/hr/cash-advances', payload);
      toast.success('Cash advance created');
      setShowCashAdvModal(false);
      refreshAll();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const cancelCashAdv = async (id: string) => {
    if (!window.confirm('Cancel this cash advance?')) return;
    try { await api.put(`/hr/cash-advances/${id}/cancel`); refreshAll(); toast.success('Cancelled'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const viewGcDetail = async (id: string) => {
    try {
      const res = await api.get(`/hr/grocery-credits/${id}`);
      setGcDetail(res.data);
      setShowGcDetailModal(true);
    } catch { toast.error('Failed to load details'); }
  };

  // === PAYROLL ===
  const openPayroll = () => { setPayrollForm({ employee_id: '', pay_period_start: '', pay_period_end: '', days_worked: '', other_deductions: [] }); setShowPayrollModal(true); };

  const openBatchPayroll = () => {
    setBatchPeriod({ pay_period_start: registerFrom, pay_period_end: registerTo });
    setBatchPreviewRows([]);
    setShowBatchPayrollModal(true);
  };

  const fetchBatchPreview = async (
    period: { pay_period_start: string; pay_period_end: string },
    overrides?: { employee_id: number; days_worked: number }[],
    preserveSelection?: Record<number, boolean>,
  ) => {
    if (!period.pay_period_start || !period.pay_period_end) {
      toast.error('Select pay period start and end');
      return;
    }
    setBatchPreviewLoading(true);
    try {
      const res = await api.post('/hr/payroll/batch/preview', {
        pay_period_start: period.pay_period_start,
        pay_period_end: period.pay_period_end,
        overrides: overrides || [],
      });
      const rows = (res.data.rows || []).map((row: any) => ({
        ...row,
        selected: preserveSelection
          ? preserveSelection[row.employee_id] ?? row.selectable
          : row.selectable,
      }));
      setBatchPreviewRows(rows);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load preview');
    } finally {
      setBatchPreviewLoading(false);
    }
  };

  const loadBatchPreview = () => fetchBatchPreview(batchPeriod);

  const scheduleBatchPreviewRefresh = (rows: any[], period = batchPeriod) => {
    if (batchPreviewTimer.current) clearTimeout(batchPreviewTimer.current);
    batchPreviewTimer.current = setTimeout(() => {
      const selection = Object.fromEntries(rows.map((r) => [r.employee_id, r.selected]));
      const overrides = rows.map((r) => ({ employee_id: r.employee_id, days_worked: r.days_worked }));
      fetchBatchPreview(period, overrides, selection);
    }, 450);
  };

  const updateBatchDay = (employeeId: number, days: string) => {
    const parsed = parseFloat(days);
    const nextDays = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
    setBatchPreviewRows((prev) => {
      const next = prev.map((row) => {
        if (row.employee_id !== employeeId) return row;
        const gross = Math.round(nextDays * parseFloat(row.daily_rate) * 100) / 100;
        return { ...row, days_worked: nextDays, gross_pay: gross };
      });
      scheduleBatchPreviewRefresh(next);
      return next;
    });
  };

  const toggleBatchRow = (employeeId: number) => {
    setBatchPreviewRows((prev) => prev.map((row) => (
      row.employee_id === employeeId && row.selectable ? { ...row, selected: !row.selected } : row
    )));
  };

  const toggleAllBatchRows = (checked: boolean) => {
    setBatchPreviewRows((prev) => prev.map((row) => (
      row.selectable ? { ...row, selected: checked } : row
    )));
  };

  const submitBatchPayroll = async () => {
    const entries = batchPreviewRows
      .filter((r) => r.selected && r.selectable)
      .map((r) => ({ employee_id: r.employee_id, days_worked: r.days_worked }));
    if (entries.length === 0) {
      toast.error('Select at least one employee with valid days');
      return;
    }
    setBatchCreating(true);
    try {
      const res = await api.post('/hr/payroll/batch', {
        pay_period_start: batchPeriod.pay_period_start,
        pay_period_end: batchPeriod.pay_period_end,
        entries,
      });
      const skipped = res.data.skipped || 0;
      toast.success(`Created ${res.data.created} payroll record(s)${skipped ? ` (${skipped} skipped)` : ''}`);
      setShowBatchPayrollModal(false);
      setBatchPreviewRows([]);
      refreshAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Batch compute failed');
    } finally {
      setBatchCreating(false);
    }
  };

  const batchSelectedRows = batchPreviewRows.filter((r) => r.selected && r.selectable);
  const batchPreviewTotals = {
    gross: batchSelectedRows.reduce((s, r) => s + parseFloat(r.gross_pay || 0), 0),
    ca: batchSelectedRows.reduce((s, r) => s + parseFloat(r.cash_advance_deduction || 0), 0),
    gc: batchSelectedRows.reduce((s, r) => s + parseFloat(r.grocery_credit_deduction || 0), 0),
    net: batchSelectedRows.reduce((s, r) => s + parseFloat(r.net_pay || 0), 0),
  };

  const savePayroll = async () => {
    try {
      const res = await api.post('/hr/payroll', { ...payrollForm, days_worked: parseIntegerField(payrollForm.days_worked) });
      toast.success(`Payroll ${res.data.payroll_number} - Net: ${formatCurrency(res.data.net_pay)}`);
      setShowPayrollModal(false);
      refreshAll();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const approvePayroll = async (id: string) => {
    if (!window.confirm('Approve this payroll? This will create accounting entries.')) return;
    try { await api.put(`/hr/payroll/${id}/approve`); refreshAll(); toast.success('Approved'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const payPayroll = async (id: string) => {
    setSelectedPayrollId(id);
    setPayAccount({ payment_account_type: 'cash', payment_account_id: '', payment_date: new Date().toISOString().split('T')[0], reference_number: '' });
    setShowPaymentModal(true);
  };

  const submitPayrollPayment = async () => {
    if (!selectedPayrollId) return;
    try {
      const payload: any = { payment_account_type: payAccount.payment_account_type, payment_date: payAccount.payment_date, reference_number: payAccount.reference_number || undefined };
      if (payAccount.payment_account_type === 'bank' && payAccount.payment_account_id) {
        payload.payment_account_id = parseInt(payAccount.payment_account_id);
      }
      await api.put(`/hr/payroll/${selectedPayrollId}/pay`, payload);
      setShowPaymentModal(false);
      setSelectedPayrollId(null);
      refreshAll(); toast.success('Payroll paid');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const cancelPayroll = async (id: string) => {
    if (!window.confirm('Cancel this payroll? This will reverse accounting entries.')) return;
    try { await api.put(`/hr/payroll/${id}/cancel`); refreshAll(); toast.success('Cancelled'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  // === PAYROLL PREVIEW ===
  const printPayrollPayslip = (id: string) => {
    if (viewingPayroll?.id === id && printFromIframe(payrollPreviewRef.current)) return;
    printDocument(`/api/hr/payroll/${id}/print`);
  };

  const openPayrollRegisterPreview = (from = registerFrom, to = registerTo) => {
    if (!from || !to) {
      toast.error('Select period from and to dates');
      return;
    }
    setViewingPayrollRegister({ from, to });
  };

  const printPayrollRegister = () => {
    if (!viewingPayrollRegister) return;
    const url = `/api/hr/payroll/register/print?from=${encodeURIComponent(viewingPayrollRegister.from)}&to=${encodeURIComponent(viewingPayrollRegister.to)}`;
    if (printFromIframe(payrollRegisterPreviewRef.current)) return;
    printDocument(url);
  };

  const payrollRegisterPreviewUrl = viewingPayrollRegister
    ? `/api/hr/payroll/register/print?from=${encodeURIComponent(viewingPayrollRegister.from)}&to=${encodeURIComponent(viewingPayrollRegister.to)}&token=${encodeURIComponent(localStorage.getItem('token') || '')}`
    : '';

  const openSssRegisterPreview = (from = sssRegisterFrom, to = sssRegisterTo) => {
    if (!from || !to) {
      toast.error('Select period from and to dates');
      return;
    }
    setViewingSssRegister({ from, to });
  };

  const printSssRegister = () => {
    if (!viewingSssRegister) return;
    const url = `/api/hr/sss-contributions/register/print?from=${encodeURIComponent(viewingSssRegister.from)}&to=${encodeURIComponent(viewingSssRegister.to)}`;
    if (printFromIframe(sssRegisterPreviewRef.current)) return;
    printDocument(url);
  };

  const sssRegisterPreviewUrl = viewingSssRegister
    ? `/api/hr/sss-contributions/register/print?from=${encodeURIComponent(viewingSssRegister.from)}&to=${encodeURIComponent(viewingSssRegister.to)}&token=${encodeURIComponent(localStorage.getItem('token') || '')}`
    : '';

  // === SSS ===
  const openSss = () => { setSssForm({ employee_id: '', period_start: '', period_end: '', employer_amount: '', employee_amount: '', notes: '' }); setShowSssModal(true); };
  const generateSSS = async () => {
    const today = new Date();
    const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const end = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()}`;
    try {
      const res = await api.post('/hr/sss-contributions/generate', { period_start: start, period_end: end });
      toast.success(`${res.data.created} SSS contributions generated for ${start} — ${end}`);
      api.get('/hr/sss-contributions').then((r) => setSssContributions(r.data));
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const saveSss = async () => {
    try {
      await api.post('/hr/sss-contributions', {
        ...sssForm,
        employer_amount: parseNumericField(sssForm.employer_amount),
        employee_amount: parseNumericField(sssForm.employee_amount),
      });
      toast.success('SSS contribution created');
      setShowSssModal(false);
      api.get('/hr/sss-contributions').then((r) => setSssContributions(r.data));
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const approveSss = async (id: string) => {
    try { await api.put(`/hr/sss-contributions/${id}/approve`); refreshAll(); toast.success('Approved'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const paySss = (id: string) => {
    setSelectedSssId(id);
    setSssPayAccount({ payment_account_type: 'cash', payment_account_id: '' });
    setShowSssPayModal(true);
  };

  const submitSssPayment = async () => {
    if (!selectedSssId) return;
    try {
      const payload: any = { payment_account_type: sssPayAccount.payment_account_type };
      if (sssPayAccount.payment_account_type === 'bank' && sssPayAccount.payment_account_id) {
        payload.payment_account_id = parseInt(sssPayAccount.payment_account_id, 10);
      }
      await api.put(`/hr/sss-contributions/${selectedSssId}/pay`, payload);
      setShowSssPayModal(false);
      setSelectedSssId(null);
      refreshAll();
      toast.success('SSS contribution paid');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const cancelSss = async (id: string) => {
    if (!window.confirm('Cancel this SSS contribution?')) return;
    try { await api.put(`/hr/sss-contributions/${id}/cancel`); refreshAll(); toast.success('Cancelled'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openPrint = (url: string) => {
    const token = encodeURIComponent(localStorage.getItem('token') || '');
    const sep = url.includes('?') ? '&' : '?';
    window.open(`${url}${sep}token=${token}`, '_blank');
  };

  if (tabs.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex items-center justify-center bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
        <p className="text-sm text-gray-600">You do not have permission to view any HR & Payroll sections.</p>
      </div>
    );
  }

  if (viewingPayroll) {
    const v = viewingPayroll;
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-slate-100" style={{ fontFamily: FINANCE_FONT }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setViewingPayroll(null)}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"
            >
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Payslip</h1>
            <span className="text-xs font-mono text-white/80">{v.payroll_number}</span>
            <span className="text-xs text-white/70 truncate">{v.last_name}, {v.first_name}</span>
          </div>
          {canPayrollPrint && (
            <button
              type="button"
              onClick={() => printPayrollPayslip(v.id)}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"
            >
              <Printer size={13} /> Print
            </button>
          )}
        </div>
        <div className="px-4 py-2 bg-white border-b border-slate-200 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
          <span><span className="text-slate-400">Period:</span> {formatDate(v.pay_period_start)} – {formatDate(v.pay_period_end)}</span>
          <span><span className="text-slate-400">Days:</span> {v.days_worked}</span>
          <span><span className="text-slate-400">Gross:</span> {formatCurrency(v.gross_pay)}</span>
          <span><span className="text-slate-400">Net Pay:</span> <strong>{formatCurrency(v.net_pay)}</strong></span>
          <span><span className="text-slate-400">Status:</span> {v.status}</span>
        </div>
        <div className="flex-1 p-6 overflow-y-auto flex justify-center">
          <div className="w-full max-w-[820px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 text-center">Document preview</div>
            <iframe
              ref={payrollPreviewRef}
              src={`/api/hr/payroll/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
              className="w-full border border-slate-300 bg-white shadow-lg rounded-sm"
              style={{ minHeight: '1100px' }}
              title={`Payslip ${v.payroll_number}`}
            />
          </div>
        </div>
      </div>
    );
  }

  if (viewingPayrollRegister) {
    const { from, to } = viewingPayrollRegister;
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-slate-100" style={{ fontFamily: FINANCE_FONT }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setViewingPayrollRegister(null)}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"
            >
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Payroll Register</h1>
            <span className="text-xs text-white/80">{formatDate(from)} – {formatDate(to)}</span>
          </div>
          {canPayrollPrint && (
            <button
              type="button"
              onClick={printPayrollRegister}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"
            >
              <Printer size={13} /> Print
            </button>
          )}
        </div>
        <div className="px-4 py-2 bg-white border-b border-slate-200 text-xs text-slate-600">
          All payroll records whose pay period overlaps the selected range (excludes cancelled).
        </div>
        <div className="flex-1 p-6 overflow-y-auto flex justify-center">
          <div className="w-full max-w-6xl">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 text-center">Document preview</div>
            <iframe
              ref={payrollRegisterPreviewRef}
              src={payrollRegisterPreviewUrl}
              className="w-full border border-slate-300 bg-white shadow-lg rounded-sm"
              style={{ minHeight: '850px' }}
              title={`Payroll Register ${from} to ${to}`}
            />
          </div>
        </div>
      </div>
    );
  }

  if (viewingSssRegister) {
    const { from, to } = viewingSssRegister;
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-slate-100" style={{ fontFamily: FINANCE_FONT }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setViewingSssRegister(null)}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"
            >
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-white font-semibold text-sm tracking-wide">SSS Contributions Register</h1>
            <span className="text-xs text-white/80">{formatDate(from)} – {formatDate(to)}</span>
          </div>
          {canPayrollPrint && (
            <button
              type="button"
              onClick={printSssRegister}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"
            >
              <Printer size={13} /> Print
            </button>
          )}
        </div>
        <div className="px-4 py-2 bg-white border-b border-slate-200 text-xs text-slate-600">
          All SSS contribution records whose period overlaps the selected range (excludes cancelled).
        </div>
        <div className="flex-1 p-6 overflow-y-auto flex justify-center">
          <div className="w-full max-w-6xl">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 text-center">Document preview</div>
            <iframe
              ref={sssRegisterPreviewRef}
              src={sssRegisterPreviewUrl}
              className="w-full border border-slate-300 bg-white shadow-lg rounded-sm"
              style={{ minHeight: '850px' }}
              title={`SSS Register ${from} to ${to}`}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Briefcase size={18} className="text-white/90 flex-shrink-0" />
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto max-w-full">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={financeTabClass(activeTab === t.key)}
              >
                <span className="inline-flex items-center gap-1">
                  <t.icon size={13} />
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          {activeTab === 'employees' && canEmpCreate && (
            <button type="button" onClick={openCreateEmployee} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-blue-900 hover:bg-blue-50">
              <Plus size={14} /> Add Employee
            </button>
          )}
          {activeTab === 'cash-advances' && canCaCreate && (
            <button type="button" onClick={openCashAdv} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-blue-900 hover:bg-blue-50">
              <Wallet size={14} /> New Advance
            </button>
          )}
          {activeTab === 'grocery' && (
            <Link to="/sales" className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-blue-900 hover:bg-blue-50">
              <ShoppingCart size={14} /> Create in Sales
            </Link>
          )}
          {activeTab === 'payroll' && (
            <>
              {canPayrollCreate && (
                <>
                  <button type="button" onClick={openPayroll} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-blue-900 hover:bg-blue-50">
                    <DollarSign size={14} /> Compute Payroll
                  </button>
                  <button type="button" onClick={openBatchPayroll} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20">
                    <Users size={14} /> Compute All
                  </button>
                </>
              )}
            </>
          )}
          {activeTab === 'sss' && canPayrollCreate && (
            <>
              <button type="button" onClick={openSss} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20">
                <Plus size={14} /> Manual SSS
              </button>
              <button type="button" onClick={generateSSS} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-blue-900 hover:bg-blue-50">
                <Shield size={14} /> Generate Month
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">

      {/* ========== EMPLOYEES TAB ========== */}
      {activeTab === 'employees' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] text-gray-500 uppercase border-b bg-gray-50"><th className="px-3 py-2 text-left">Code</th><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Position</th><th className="px-3 py-2 text-right">Daily Rate</th><th className="px-3 py-2 text-right">CA Balance</th><th className="px-3 py-2 text-right">GC Balance</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Actions</th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-gray-50 hover:bg-blue-50/30">
                  <td className="px-3 py-2 font-mono text-blue-700">{e.employee_code}</td>
                  <td className="px-3 py-2 font-medium">{e.last_name}, {e.first_name}</td>
                  <td className="px-3 py-2">{e.position || '—'}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(e.daily_rate)}</td>
                  <td className="px-3 py-2 text-right text-orange-700 font-medium">{formatCurrency(e.cash_advance_balance)}</td>
                  <td className="px-3 py-2 text-right text-teal-700 font-medium">{formatCurrency(e.grocery_credit_balance)}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 text-[10px] rounded-full ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{e.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {canEmpEdit && <button type="button" onClick={() => openEditEmployee(e)} className="p-1 hover:bg-blue-100 rounded text-blue-700"><Edit2 size={14} /></button>}
                      <button type="button" onClick={() => viewLedger(e.id)} className="p-1 hover:bg-purple-100 rounded text-purple-700" title="Ledger"><FileText size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan={8} className="text-center text-gray-400 py-10">No employees yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== CASH ADVANCES TAB ========== */}
      {activeTab === 'cash-advances' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Date</th><th>Amount</th><th>Installment</th><th>Remaining</th><th>Account</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {cashAdvances.map((ca) => (
                <tr key={ca.id}>
                  <td className="font-medium">{employeeName(ca)}</td>
                  <td>{formatDate(ca.advance_date)}</td>
                  <td className="font-bold text-orange-700">{formatCurrency(ca.amount)}</td>
                  <td className="text-xs">{parseFloat(ca.installment_amount) > 0 ? `${formatCurrency(ca.installment_amount)}/pay` : 'Lump sum'}</td>
                  <td>{formatCurrency(ca.remaining_balance)}</td>
                  <td className="text-xs">{ca.payment_account_type || 'cash'}</td>
                  <td><span className={statusBadge(ca.status)}>{ca.status}</span></td>
                  <td>
                    {ca.status === 'Active' && canCaEdit && (
                      <button type="button" onClick={() => cancelCashAdv(ca.id)} className="p-1 hover:bg-red-100 rounded text-red-600"><XCircle size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
              {cashAdvances.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-6">No cash advances yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== GROCERY CREDITS TAB (from Sales Invoices) ========== */}
      {activeTab === 'grocery' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Invoice #</th><th>Employee</th><th>Date</th><th>Total</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {groceryCredits.map((gc) => (
                <tr key={gc.id}>
                  <td className="font-mono text-xs text-blue-600 cursor-pointer hover:underline" onClick={() => viewGcDetail(gc.id)}>{gc.credit_number}</td>
                  <td>{employeeName(gc)}</td>
                  <td>{formatDate(gc.credit_date)}</td>
                  <td className="font-bold text-teal-700">{formatCurrency(gc.total)}</td>
                  <td className={gc.balance > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(gc.balance || 0)}</td>
                  <td><span className={statusBadge(gc.status)}>{gc.status}</span></td>
                  <td>
                    <button onClick={() => viewGcDetail(gc.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="View Details"><FileText size={14} /></button>
                  </td>
                </tr>
              ))}
              {groceryCredits.length === 0 && <tr><td colSpan={7} className="text-center text-gray-500 py-6">No employee grocery credits yet. Create a Sales Invoice with Customer Type = Employee.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== PAYROLL TAB ========== */}
      {activeTab === 'payroll' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap bg-white border border-gray-200 rounded-lg p-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Period from</label>
              <input type="date" value={registerFrom} onChange={(e) => setRegisterFrom(e.target.value)} className="px-2 py-1.5 border rounded-md text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Period to</label>
              <input type="date" value={registerTo} onChange={(e) => setRegisterTo(e.target.value)} className="px-2 py-1.5 border rounded-md text-xs" />
            </div>
            <p className="text-[10px] text-gray-500 pb-1 max-w-xs">
              Print Register lists all payroll records whose pay period overlaps this range (excludes cancelled).
            </p>
            {canPayrollPrint && (
              <button
                type="button"
                onClick={() => openPayrollRegisterPreview(registerFrom, registerTo)}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700"
              >
                <Eye size={14} /> View Register
              </button>
            )}
          </div>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] text-gray-500 uppercase border-b bg-gray-50"><th className="px-3 py-2 text-left">Ref #</th><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Period</th><th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">CA Ded.</th><th className="px-3 py-2 text-right">GC Ded.</th><th className="px-3 py-2 text-right">Net Pay</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Actions</th></tr></thead>
            <tbody>
              {payroll.map((p) => (
                <tr key={p.id} className="border-t border-gray-50 hover:bg-blue-50/30">
                  <td className="px-3 py-2 font-mono text-blue-700">{p.payroll_number}</td>
                  <td className="px-3 py-2">{p.last_name}, {p.first_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.pay_period_start)} – {formatDate(p.pay_period_end)}</td>
                  <td className="px-3 py-2 text-right">{p.days_worked}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(p.gross_pay)}</td>
                  <td className="px-3 py-2 text-right text-orange-700">{formatCurrency(p.cash_advance_deduction)}</td>
                  <td className="px-3 py-2 text-right text-teal-700">{formatCurrency(p.grocery_credit_deduction)}</td>
                  <td className="px-3 py-2 text-right font-bold">{formatCurrency(p.net_pay)}</td>
                  <td className="px-3 py-2"><span className={statusBadge(p.status)}>{p.status}</span></td>
                  <td className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap items-center">
                        <button type="button" onClick={() => setViewingPayroll(p)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="View Payslip"><Eye size={14} /></button>
                        {p.status === 'Draft' && canPayrollApprove && <button type="button" onClick={() => approvePayroll(p.id)} className="p-1 hover:bg-blue-100 rounded text-blue-700" title="Approve"><CheckCircle size={14} /></button>}
                      {p.status === 'Posted' && canPayrollApprove && <button type="button" onClick={() => payPayroll(p.id)} className="p-1 hover:bg-green-100 rounded text-green-700" title="Pay"><CreditCard size={14} /></button>}
                        {p.status !== 'Paid' && p.status !== 'Cancelled' && canPayrollEdit && <button type="button" onClick={() => cancelPayroll(p.id)} className="p-1 hover:bg-red-100 rounded text-red-600" title="Cancel"><XCircle size={14} /></button>}
                        {p.status === 'Paid' && p.payment_voucher_number && canPayrollPrint && <button type="button" onClick={() => openPrint(`/api/hr/payroll/${p.id}/payment-voucher/print`)} className="p-1 hover:bg-gray-100 rounded text-gray-600" title="Print Payment Voucher"><Printer size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {payroll.length === 0 && <tr><td colSpan={10} className="text-center text-gray-400 py-10">No payroll records yet</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ========== SSS TAB ========== */}
      {activeTab === 'sss' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap bg-white border border-gray-200 rounded-lg p-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Period from</label>
              <input type="date" value={sssRegisterFrom} onChange={(e) => setSssRegisterFrom(e.target.value)} className="px-2 py-1.5 border rounded-md text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Period to</label>
              <input type="date" value={sssRegisterTo} onChange={(e) => setSssRegisterTo(e.target.value)} className="px-2 py-1.5 border rounded-md text-xs" />
            </div>
            <p className="text-[10px] text-gray-500 pb-1 max-w-xs">
              View Register lists all generated SSS contributions for the selected period (excludes cancelled).
            </p>
            {canPayrollPrint && (
              <button
                type="button"
                onClick={() => openSssRegisterPreview(sssRegisterFrom, sssRegisterTo)}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700"
              >
                <Eye size={14} /> View Register
              </button>
            )}
          </div>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Ref #</th><th>Employee</th><th>Period</th><th>Employer</th><th>Employee</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {sssContributions.map((sc) => (
                <tr key={sc.id}>
                  <td className="font-mono text-xs">{sc.contribution_number}</td>
                  <td>{employeeName(sc)}</td>
                  <td className="text-xs">{formatDate(sc.period_start)} - {formatDate(sc.period_end)}</td>
                  <td className="text-blue-700">{formatCurrency(sc.employer_amount)}</td>
                  <td className="text-red-700">{formatCurrency(sc.employee_amount || 0)}</td>
                  <td className="font-bold">{formatCurrency(parseFloat(sc.employer_amount) + parseFloat(sc.employee_amount || 0))}</td>
                  <td><span className={statusBadge(sc.status)}>{sc.status}</span></td>
                  <td>
                    <div className="flex gap-1">
                      {sc.status === 'Draft' && canPayrollApprove && <button type="button" onClick={() => approveSss(sc.id)} className="p-1 hover:bg-blue-100 rounded text-blue-700" title="Approve"><CheckCircle size={14} /></button>}
                      {sc.status === 'Posted' && canPayrollEdit && <button type="button" onClick={() => paySss(sc.id)} className="p-1 hover:bg-green-100 rounded text-green-700" title="Pay"><CreditCard size={14} /></button>}
                      {sc.status !== 'Paid' && sc.status !== 'Cancelled' && canPayrollEdit && <button type="button" onClick={() => cancelSss(sc.id)} className="p-1 hover:bg-red-100 rounded text-red-600"><XCircle size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {sssContributions.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-6">No SSS contributions yet</td></tr>}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* ========== ATTENDANCE SHEET TAB ========== */}
      {activeTab === 'attendance-sheet' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap bg-white border border-gray-200 rounded-lg p-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">From</label>
              <input type="date" value={sheetFrom} onChange={e => setSheetFrom(e.target.value)} className="px-2 py-1.5 border rounded-md text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">To</label>
              <input type="date" value={sheetTo} onChange={e => setSheetTo(e.target.value)} className="px-2 py-1.5 border rounded-md text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Employee</label>
              <select value={sheetEmployeeId} onChange={e => setSheetEmployeeId(e.target.value)} className="px-2 py-1.5 border rounded-md text-xs min-w-[160px]">
                <option value="">All Active</option>
                {employees.map(e => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={loadSheet} className="px-3 py-1.5 bg-blue-700 text-white rounded-md text-xs font-semibold hover:bg-blue-800">Load</button>
              {canAttendanceEdit && (
                <button type="button" onClick={saveSheet} disabled={sheetSaving || Object.keys(sheetChanges).length === 0} className="px-3 py-1.5 bg-green-700 text-white rounded-md text-xs font-semibold hover:bg-green-800 disabled:opacity-50">
                  {sheetSaving ? 'Saving…' : `Save (${Object.keys(sheetChanges).length})`}
                </button>
              )}
              {canAttendancePrint && (
                <button type="button" onClick={() => openPrint(`/api/hr/attendance/sheet/print?from=${sheetFrom}&to=${sheetTo}&employee_id=${sheetEmployeeId}`)} className="px-3 py-1.5 bg-gray-600 text-white rounded-md text-xs font-semibold hover:bg-gray-700">Print</button>
              )}
            </div>
          </div>

          {sheetData && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="text-xs border-collapse w-max min-w-full">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-semibold border-r z-10" style={{ minWidth: 180 }}>Employee</th>
                    {sheetData.dates.map((dt: string) => {
                      const d = new Date(dt + 'T12:00:00');
                      return (
                        <th key={dt} className="px-2 py-2 text-center font-semibold border-r" style={{ minWidth: 55 }}>
                          <div className="text-[10px] text-gray-500">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}</div>
                          <div>{d.getDate()}</div>
                        </th>
                      );
                    })}
                    <th className="px-2 py-2 text-center bg-blue-50 border-l-2">P</th>
                    <th className="px-2 py-2 text-center">A</th>
                    <th className="px-2 py-2 text-center">L</th>
                    <th className="px-2 py-2 text-center">H</th>
                    <th className="px-2 py-2 text-center">Leave</th>
                    <th className="px-2 py-2 text-center">RD</th>
                    <th className="px-2 py-2 text-center font-bold bg-green-50">W</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetData.employees.map((e: any) => (
                    <tr key={e.id} className="border-t hover:bg-gray-50">
                      <td className="sticky left-0 bg-white px-3 py-1.5 border-r z-10">
                        <div className="font-medium text-gray-900">{e.name}</div>
                        <div className="text-[10px] text-gray-400">{e.code}</div>
                      </td>
                      {sheetData.dates.map((dt: string) => {
                        const key = `${e.id}_${dt}`;
                        const changed = sheetChanges[key];
                        const rec = e.days[dt];
                        const status = changed !== undefined ? (changed || null) : rec?.status;
                        const bg = !status ? '' : status === 'Present' ? 'bg-green-100 text-green-700' : status === 'Absent' ? 'bg-red-100 text-red-700' : status === 'Late' ? 'bg-yellow-100 text-yellow-700' : status === 'Half-day' ? 'bg-orange-100 text-orange-700' : status === 'Leave' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600';
                        return (
                          <td
                            key={dt}
                            className={`px-1 py-1 text-center border-r ${canAttendanceEdit ? 'cursor-pointer hover:ring-2 hover:ring-blue-400' : ''}`}
                            onClick={() => canAttendanceEdit && toggleSheetStatus(e.id, dt, status)}
                          >
                            <span className={`inline-block w-7 h-5 rounded text-[10px] font-bold leading-5 ${bg} ${changed !== undefined ? 'ring-2 ring-blue-500' : ''}`}>
                              {status === 'Present' ? 'P' : status === 'Absent' ? 'A' : status === 'Late' ? 'L' : status === 'Half-day' ? 'H' : status === 'Leave' ? 'LV' : status === 'Rest Day' ? 'RD' : ''}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-center font-bold text-green-700 bg-blue-50 border-l-2">{e.summary.present}</td>
                      <td className="px-2 py-1 text-center font-bold text-red-700">{e.summary.absent}</td>
                      <td className="px-2 py-1 text-center font-bold text-yellow-700">{e.summary.late}</td>
                      <td className="px-2 py-1 text-center font-bold text-orange-700">{e.summary.half_day}</td>
                      <td className="px-2 py-1 text-center font-bold text-blue-700">{e.summary.leave}</td>
                      <td className="px-2 py-1 text-center font-bold text-gray-500">{e.summary.rest_day}</td>
                      <td className="px-2 py-1 text-center font-bold bg-green-50">{e.summary.worked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 border-t bg-gray-50 text-[10px] text-gray-500 flex flex-wrap gap-3">
                <span>P = Present · A = Absent · L = Late · H = Half-day · LV = Leave · RD = Rest Day · W = Worked days</span>
                {canAttendanceEdit && <span className="text-blue-600">Click cell to cycle · Blue outline = unsaved</span>}
              </div>
            </div>
          )}
          {!sheetData && <div className="text-center py-12 text-gray-400 bg-white border border-gray-200 rounded-lg">Click Load to generate the attendance sheet</div>}
        </div>
      )}

      </div>

      {/* ========== MODALS ========== */}

      {/* Employee Modal */}
      {showEmployeeModal && (
        <ModalOverlay onClose={() => setShowEmployeeModal(false)}>
          <div className="modal-content max-w-lg">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editEmployee ? 'Edit Employee' : 'Add Employee'}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1">First Name *</label><input type="text" value={empForm.first_name} onChange={(e) => setEmpForm({ ...empForm, first_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Last Name *</label><input type="text" value={empForm.last_name} onChange={(e) => setEmpForm({ ...empForm, last_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Position</label><input type="text" value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Department</label><input type="text" value={empForm.department} onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Daily Rate</label><input type="number" step="0.01" value={empForm.daily_rate} onChange={(e) => setEmpForm({ ...empForm, daily_rate: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Monthly Rate</label><input type="number" step="0.01" value={empForm.monthly_rate} onChange={(e) => setEmpForm({ ...empForm, monthly_rate: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Phone</label><input type="text" value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Employment Type</label>
                  <select value={empForm.employment_type} onChange={(e) => setEmpForm({ ...empForm, employment_type: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Regular">Regular</option><option value="Contractual">Contractual</option><option value="Probationary">Probationary</option><option value="Part-time">Part-time</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Hire Date</label><input type="date" value={empForm.hire_date || ''} onChange={(e) => setEmpForm({ ...empForm, hire_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Credit Limit</label><input type="number" step="0.01" value={empForm.credit_limit} onChange={(e) => setEmpForm({ ...empForm, credit_limit: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Default SSS Monthly</label><input type="number" step="0.01" value={empForm.sss_default_amount} onChange={(e) => setEmpForm({ ...empForm, sss_default_amount: e.target.value })} placeholder="e.g. 780" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <p className="text-[10px] text-gray-400">Set the monthly SSS amount if the company shoulders both shares. Leave 0 if the employee does not have SSS.</p>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowEmployeeModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveEmployee} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Cash Advance Modal */}
      {showCashAdvModal && (
        <ModalOverlay onClose={() => setShowCashAdvModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">New Cash Advance</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Employee *</label>
                  <select value={cashAdvForm.employee_id} onChange={(e) => setCashAdvForm({ ...cashAdvForm, employee_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={cashAdvForm.amount} onChange={(e) => setCashAdvForm({ ...cashAdvForm, amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-sm font-medium mb-1">Installment / Payroll</label><input type="number" value={cashAdvForm.installment_amount} onChange={(e) => setCashAdvForm({ ...cashAdvForm, installment_amount: e.target.value })} placeholder="e.g. 1000" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  <div><label className="block text-sm font-medium mb-1">No. of Installments</label><input type="number" value={cashAdvForm.installment_count} onChange={(e) => setCashAdvForm({ ...cashAdvForm, installment_count: e.target.value })} placeholder="e.g. 4" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                </div>
                <p className="text-[10px] text-gray-400 -mt-1">Leave at 0 to deduct full balance in one payroll. Set installment amount to deduct a fixed amount per pay period.</p>
                <div><label className="block text-sm font-medium mb-1">Payment Account</label>
                  <select value={cashAdvForm.payment_account_type} onChange={(e) => setCashAdvForm({ ...cashAdvForm, payment_account_type: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="cash">Cash on Hand</option><option value="bank">Bank</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={cashAdvForm.notes} onChange={(e) => setCashAdvForm({ ...cashAdvForm, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCashAdvModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveCashAdv} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700">Create</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Payroll Modal */}
      {showPayrollModal && (
        <ModalOverlay onClose={() => setShowPayrollModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Compute Payroll</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Employee</label>
                  <select value={payrollForm.employee_id} onChange={(e) => {
                    const id = e.target.value;
                    setPayrollForm({ ...payrollForm, employee_id: id });
                    if (id && payrollForm.pay_period_start && payrollForm.pay_period_end) {
                      api.get('/hr/attendance/worked-days', { params: { employee_id: id, from: payrollForm.pay_period_start, to: payrollForm.pay_period_end } })
                        .then((r) => setPayrollForm((pf: any) => ({ ...pf, days_worked: r.data.worked_days })))
                        .catch(() => {});
                    }
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
                  </select></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-sm font-medium mb-1">Start Period</label><input type="date" value={payrollForm.pay_period_start} onChange={(e) => {
                    const val = e.target.value;
                    setPayrollForm({ ...payrollForm, pay_period_start: val });
                    if (payrollForm.employee_id && val && payrollForm.pay_period_end) {
                      api.get('/hr/attendance/worked-days', { params: { employee_id: payrollForm.employee_id, from: val, to: payrollForm.pay_period_end } })
                        .then((r) => setPayrollForm((pf: any) => ({ ...pf, days_worked: r.data.worked_days })))
                        .catch(() => {});
                    }
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  <div><label className="block text-sm font-medium mb-1">End Period</label><input type="date" value={payrollForm.pay_period_end} onChange={(e) => {
                    const val = e.target.value;
                    setPayrollForm({ ...payrollForm, pay_period_end: val });
                    if (payrollForm.employee_id && payrollForm.pay_period_start && val) {
                      api.get('/hr/attendance/worked-days', { params: { employee_id: payrollForm.employee_id, from: payrollForm.pay_period_start, to: val } })
                        .then((r) => setPayrollForm((pf: any) => ({ ...pf, days_worked: r.data.worked_days })))
                        .catch(() => {});
                    }
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                </div>
                <div><label className="block text-sm font-medium mb-1">Days Worked</label><input type="number" value={payrollForm.days_worked} onChange={(e) => setPayrollForm({ ...payrollForm, days_worked: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <p className="text-xs text-gray-500 italic">Cash advance and grocery credit deductions are auto-computed.</p>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowPayrollModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={savePayroll} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Compute</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Batch Payroll Modal */}
      {showBatchPayrollModal && (
        <ModalOverlay onClose={() => setShowBatchPayrollModal(false)}>
          <div className="modal-content max-w-4xl w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Compute All Employees</h2>
                <button type="button" onClick={() => setShowBatchPayrollModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Start Period</label>
                  <input
                    type="date"
                    value={batchPeriod.pay_period_start}
                    onChange={(e) => setBatchPeriod((p) => ({ ...p, pay_period_start: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Period</label>
                  <input
                    type="date"
                    value={batchPeriod.pay_period_end}
                    onChange={(e) => setBatchPeriod((p) => ({ ...p, pay_period_end: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={loadBatchPreview}
                  disabled={batchPreviewLoading}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {batchPreviewLoading ? 'Loading…' : 'Load Preview'}
                </button>
                <p className="text-xs text-gray-500">Days from attendance; CA and GC deductions auto-computed.</p>
              </div>

              {batchPreviewRows.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
                  <div className="max-h-[360px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="text-[10px] text-gray-500 uppercase">
                          <th className="px-2 py-2 text-left w-8">
                            <input
                              type="checkbox"
                              checked={batchPreviewRows.some((r) => r.selectable) && batchPreviewRows.filter((r) => r.selectable).every((r) => r.selected)}
                              onChange={(e) => toggleAllBatchRows(e.target.checked)}
                            />
                          </th>
                          <th className="px-2 py-2 text-left">Employee</th>
                          <th className="px-2 py-2 text-right">Days</th>
                          <th className="px-2 py-2 text-right">Gross</th>
                          <th className="px-2 py-2 text-right">CA Ded.</th>
                          <th className="px-2 py-2 text-right">GC Ded.</th>
                          <th className="px-2 py-2 text-right">Net Pay</th>
                          <th className="px-2 py-2 text-left">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchPreviewRows.map((row) => (
                          <tr key={row.employee_id} className={`border-t border-gray-100 ${!row.selectable ? 'bg-gray-50 text-gray-400' : 'hover:bg-blue-50/30'}`}>
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={!!row.selected}
                                disabled={!row.selectable}
                                onChange={() => toggleBatchRow(row.employee_id)}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <div className="font-medium">{row.last_name}, {row.first_name}</div>
                              <div className="font-mono text-[10px] text-gray-400">{row.employee_code}</div>
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                value={row.days_worked}
                                disabled={!!row.skip_reason?.includes('Already has')}
                                onChange={(e) => updateBatchDay(row.employee_id, e.target.value)}
                                className="w-16 px-1.5 py-1 border rounded text-right text-xs"
                              />
                            </td>
                            <td className="px-2 py-2 text-right">{formatCurrency(row.gross_pay)}</td>
                            <td className="px-2 py-2 text-right text-orange-700">{formatCurrency(row.cash_advance_deduction)}</td>
                            <td className="px-2 py-2 text-right text-teal-700">{formatCurrency(row.grocery_credit_deduction)}</td>
                            <td className="px-2 py-2 text-right font-bold">{formatCurrency(row.net_pay)}</td>
                            <td className="px-2 py-2 text-[10px] text-amber-700">{row.skip_reason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <span><span className="text-gray-500">Selected:</span> <strong>{batchSelectedRows.length}</strong></span>
                    <span><span className="text-gray-500">Gross:</span> <strong>{formatCurrency(batchPreviewTotals.gross)}</strong></span>
                    <span><span className="text-gray-500">CA:</span> <strong className="text-orange-700">{formatCurrency(batchPreviewTotals.ca)}</strong></span>
                    <span><span className="text-gray-500">GC:</span> <strong className="text-teal-700">{formatCurrency(batchPreviewTotals.gc)}</strong></span>
                    <span><span className="text-gray-500">Net Pay:</span> <strong className="text-green-700">{formatCurrency(batchPreviewTotals.net)}</strong></span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowBatchPayrollModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button
                  type="button"
                  onClick={submitBatchPayroll}
                  disabled={batchCreating || batchSelectedRows.length === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {batchCreating ? 'Creating…' : `Create ${batchSelectedRows.length} Payroll${batchSelectedRows.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Pay Payroll Modal */}
      {showPaymentModal && (
        <ModalOverlay onClose={() => setShowPaymentModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Pay Payroll</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select value={payAccount.payment_account_type} onChange={(e) => setPayAccount({ ...payAccount, payment_account_type: e.target.value, payment_account_id: '' })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="cash">Cash</option>
                    <option value="bank">Check / Bank Transfer</option>
                  </select>
                </div>
                {payAccount.payment_account_type === 'bank' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Bank Account</label>
                    <select value={payAccount.payment_account_id} onChange={(e) => setPayAccount({ ...payAccount, payment_account_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">Select</option>
                      {bankAccounts.map((ba) => <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name} ({ba.account_number})</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Reference Number {payAccount.payment_account_type === 'bank' ? '(Check #)' : ''}</label>
                  <input type="text" value={payAccount.reference_number} onChange={(e) => setPayAccount({ ...payAccount, reference_number: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder={payAccount.payment_account_type === 'bank' ? 'Check number' : 'OR / Ref #'} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Date</label>
                  <input type="date" value={payAccount.payment_date} onChange={(e) => setPayAccount({ ...payAccount, payment_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowPaymentModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={submitPayrollPayment} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Confirm Payment</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Pay SSS Modal */}
      {showSssPayModal && (
        <ModalOverlay onClose={() => setShowSssPayModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Pay SSS Contribution</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select
                    value={sssPayAccount.payment_account_type}
                    onChange={(e) => setSssPayAccount({ ...sssPayAccount, payment_account_type: e.target.value, payment_account_id: '' })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Check / Bank Transfer</option>
                  </select>
                </div>
                {sssPayAccount.payment_account_type === 'bank' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Bank Account</label>
                    <select
                      value={sssPayAccount.payment_account_id}
                      onChange={(e) => setSssPayAccount({ ...sssPayAccount, payment_account_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">Select</option>
                      {bankAccounts.map((ba) => <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowSssPayModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={submitSssPayment} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Confirm Payment</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Employee Ledger Modal */}
      {showLedgerModal && ledgerData && (
        <ModalOverlay onClose={() => setShowLedgerModal(false)}>
          <div className="modal-content max-w-3xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Employee Ledger</h2>
                <button onClick={() => setShowLedgerModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="mb-4 flex justify-between text-sm">
                <span className="font-medium">Running Balance: <span className={ledgerData.running_balance > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(ledgerData.running_balance)}</span></span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th><th>Module</th></tr></thead>
                  <tbody>
                    {ledgerData.rows.map((row: any, i: number) => (
                      <tr key={i}>
                        <td className="text-xs">{formatDate(row.date)}</td>
                        <td className="text-xs">{row.transaction_type}</td>
                        <td className="font-mono text-xs">{row.reference_no || '-'}</td>
                        <td className="text-xs">{row.description}</td>
                        <td className="text-right text-red-600">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                        <td className="text-right text-green-600">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                        <td className="text-right font-mono text-xs">{formatCurrency(row.running_balance)}</td>
                        <td className="text-xs">{row.source_module}</td>
                      </tr>
                    ))}
                    {ledgerData.rows.length === 0 && <tr><td colSpan={8} className="text-center py-4 text-gray-500">No transactions</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* SSS Modal */}
      {showSssModal && (
        <ModalOverlay onClose={() => setShowSssModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">SSS Employer Contribution</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Employee *</label>
                  <select value={sssForm.employee_id} onChange={(e) => setSssForm({ ...sssForm, employee_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
                  </select></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-sm font-medium mb-1">Period Start</label><input type="date" value={sssForm.period_start} onChange={(e) => setSssForm({ ...sssForm, period_start: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  <div><label className="block text-sm font-medium mb-1">Period End</label><input type="date" value={sssForm.period_end} onChange={(e) => setSssForm({ ...sssForm, period_end: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-sm font-medium mb-1">Employer Amount</label><input type="number" step="0.01" value={sssForm.employer_amount} onChange={(e) => setSssForm({ ...sssForm, employer_amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  <div><label className="block text-sm font-medium mb-1">Employee Amount</label><input type="number" step="0.01" value={sssForm.employee_amount} onChange={(e) => setSssForm({ ...sssForm, employee_amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowSssModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={saveSss} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Create</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Grocery Credit Detail Modal */}
      {showGcDetailModal && gcDetail && (
        <ModalOverlay onClose={() => setShowGcDetailModal(false)}>
          <div className="modal-content max-w-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Grocery Credit {gcDetail.credit_number}</h2>
                <button onClick={() => setShowGcDetailModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="text-sm space-y-1 mb-3">
                <p><span className="text-gray-500">Employee:</span> <span className="font-medium">{employeeName(gcDetail)}</span></p>
                <p><span className="text-gray-500">Date:</span> {formatDate(gcDetail.credit_date)} <span className="ml-4 text-gray-500">Status:</span> <span className={statusBadge(gcDetail.status)}>{gcDetail.status}</span></p>
              </div>
              <table className="data-table w-full">
                <thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
                <tbody>
                  {gcDetail.items?.map((item: any, i: number) => (
                    <tr key={i}>
                      <td>{item.description || item.product_name || '-'}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unit_price)}</td>
                      <td className="font-medium">{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-between font-bold mt-3 text-sm"><span>Total</span><span>{formatCurrency(gcDetail.total)}</span></div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
