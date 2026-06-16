import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  Plus, Edit2, DollarSign, Clock, FileText, X, Wallet, ShoppingCart,
  CheckCircle, XCircle, Shield, UserCheck, CreditCard, Printer,
} from 'lucide-react';
import toast from 'react-hot-toast';

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
  const [activeTab, setActiveTab] = useState('employees');
  const [employees, setEmployees] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [cashAdvances, setCashAdvances] = useState<any[]>([]);
  const [groceryCredits, setGroceryCredits] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [sssContributions, setSssContributions] = useState<any[]>([]);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [payslipData, setPayslipData] = useState<any>(null);

  // Modals
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showCashAdvModal, setShowCashAdvModal] = useState(false);
  const [showGroceryModal, setShowGroceryModal] = useState(false);
  const [showPayslipModal, setShowPayslipModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showSssModal, setShowSssModal] = useState(false);
  const [showGcDetailModal, setShowGcDetailModal] = useState(false);
  const [gcDetail, setGcDetail] = useState<any>(null);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPayrollId, setSelectedPayrollId] = useState<string | null>(null);

  // Attendance Sheet state
  const [sheetData, setSheetData] = useState<any>(null);
  const today = new Date();
  const [sheetFrom, setSheetFrom] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [sheetTo, setSheetTo] = useState(toLocalDate(new Date(today.getFullYear(), today.getMonth(), 15)));
  const [sheetEmployeeId, setSheetEmployeeId] = useState('');
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetChanges, setSheetChanges] = useState<Record<string, string>>({});

  const [editEmployee, setEditEmployee] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [empForm, setEmpForm] = useState<any>({ first_name: '', last_name: '', position: '', department: '', daily_rate: 0, monthly_rate: 0, phone: '', email: '', sss: '', philhealth: '', pagibig: '', tin: '', employment_type: 'Regular', hire_date: '', credit_limit: 0 });
  const [payrollForm, setPayrollForm] = useState<any>({ employee_id: '', pay_period_start: '', pay_period_end: '', days_worked: 0, other_deductions: [] });
  const [attendanceForm, setAttendanceForm] = useState({ employee_id: '', date: '', time_in: '', time_out: '' });
  const [cashAdvForm, setCashAdvForm] = useState<any>({ employee_id: '', amount: 0, payment_account_type: 'cash', notes: '' });
  const [groceryForm, setGroceryForm] = useState<any>({ employee_id: '', location_id: '', credit_date: '', notes: '', items: [{ product_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, cost: 0 }] });
  const [sssForm, setSssForm] = useState<any>({ employee_id: '', period_start: '', period_end: '', employer_amount: 0, employee_amount: 0, notes: '' });
  const [payAccount, setPayAccount] = useState({ payment_account_type: 'cash', payment_account_id: '', payment_date: '', reference_number: '' });

  // Load data on mount and tab change
  useEffect(() => {
    api.get('/hr/employees').then((res) => setEmployees(res.data)).catch(() => {});
    api.get('/bank-cash/accounts/all').then((res) => setBankAccounts(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const tab = activeTab;
    if (tab === 'payroll') { api.get('/hr/payroll').then((r) => setPayroll(r.data)).catch(() => {}); }
    if (tab === 'cash-advances') { api.get('/hr/cash-advances').then((r) => setCashAdvances(r.data)).catch(() => {}); }
    if (tab === 'grocery') { api.get('/hr/grocery-credits').then((r) => setGroceryCredits(r.data)).catch(() => {}); }
    if (tab === 'attendance') { api.get('/hr/attendance').then((r) => setAttendance(r.data)).catch(() => {}); }
    if (tab === 'sss') { api.get('/hr/sss-contributions').then((r) => setSssContributions(r.data)).catch(() => {}); }
    if (tab === 'attendance-sheet') { loadSheet(); }
  }, [activeTab]);

  const loadSheet = () => {
    setSheetChanges({});
    const from = new Date(sheetFrom);
    const endDate = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    if (new Date(sheetTo) > endDate) setSheetTo(toLocalDate(endDate));
    const params = `from=${sheetFrom}&to=${sheetTo}${sheetEmployeeId ? '&employee_id=' + sheetEmployeeId : ''}`;
    api.get('/hr/attendance/sheet?' + params).then(r => setSheetData(r.data)).catch(() => {});
  };

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
    setEmpForm({ first_name: '', last_name: '', position: '', department: '', daily_rate: 0, monthly_rate: 0, phone: '', email: '', sss: '', philhealth: '', pagibig: '', tin: '', employment_type: 'Regular', hire_date: '', credit_limit: 0 });
    setShowEmployeeModal(true);
  };
  const openEditEmployee = (e: any) => { setEditEmployee(e); setEmpForm(e); setShowEmployeeModal(true); };

  const saveEmployee = async () => {
    try {
      if (editEmployee) { await api.put(`/hr/employees/${editEmployee.id}`, empForm); toast.success('Updated'); }
      else { await api.post('/hr/employees', empForm); toast.success('Created'); }
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
  const openCashAdv = () => { setCashAdvForm({ employee_id: '', amount: 0, payment_account_type: 'cash', notes: '' }); setShowCashAdvModal(true); };
  const saveCashAdv = async () => {
    try {
      await api.post('/hr/cash-advances', cashAdvForm);
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

  // === GROCERY CREDITS ===
  const openGrocery = () => {
    setGroceryForm({ employee_id: '', location_id: '', credit_date: '', notes: '', items: [{ product_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, cost: 0 }] });
    setShowGroceryModal(true);
  };
  const addGroceryItem = () => {
    setGroceryForm({ ...groceryForm, items: [...groceryForm.items, { product_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, cost: 0 }] });
  };
  const removeGroceryItem = (i: number) => {
    setGroceryForm({ ...groceryForm, items: groceryForm.items.filter((_: any, idx: number) => idx !== i) });
  };
  const updateGroceryItem = (i: number, field: string, value: any) => {
    const items = [...groceryForm.items];
    items[i] = { ...items[i], [field]: value };
    setGroceryForm({ ...groceryForm, items });
  };
  const saveGrocery = async () => {
    try {
      const res = await api.post('/hr/grocery-credits', groceryForm);
      toast.success(`Grocery credit ${res.data.credit_number} created`);
      setShowGroceryModal(false);
      refreshAll();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const postGrocery = async (id: string) => {
    if (!window.confirm('Post this grocery credit? This will deduct inventory.')) return;
    try { await api.put(`/hr/grocery-credits/${id}/post`); refreshAll(); toast.success('Posted'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const cancelGrocery = async (id: string) => {
    if (!window.confirm('Cancel this grocery credit?')) return;
    try { await api.put(`/hr/grocery-credits/${id}/cancel`); refreshAll(); toast.success('Cancelled'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const viewGcDetail = async (id: string) => {
    try {
      const res = await api.get(`/hr/grocery-credits/${id}`);
      setGcDetail(res.data);
      setShowGcDetailModal(true);
    } catch { toast.error('Failed to load details'); }
  };

  // === ATTENDANCE ===
  const openCreateAttendance = () => { setAttendanceForm({ employee_id: '', date: '', time_in: '', time_out: '' }); setShowAttendanceModal(true); };
  const saveAttendance = async () => {
    try {
      await api.post('/hr/attendance', attendanceForm);
      toast.success('Recorded');
      setShowAttendanceModal(false);
      api.get('/hr/attendance').then((r) => setAttendance(r.data));
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  // === PAYROLL ===
  const openPayroll = () => { setPayrollForm({ employee_id: '', pay_period_start: '', pay_period_end: '', days_worked: 0, other_deductions: [] }); setShowPayrollModal(true); };
  const savePayroll = async () => {
    try {
      const res = await api.post('/hr/payroll', payrollForm);
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
    const p = payroll.find((x) => x.id === id);
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

  // === PAYSLIP ===
  const viewPayslip = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/hr/payslip/${id}`);
      setPayslipData(res.data);
      setShowPayslipModal(true);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  // === SSS ===
  const openSss = () => { setSssForm({ employee_id: '', period_start: '', period_end: '', employer_amount: 0, notes: '' }); setShowSssModal(true); };
  const saveSss = async () => {
    try {
      await api.post('/hr/sss-contributions', sssForm);
      toast.success('SSS contribution created');
      setShowSssModal(false);
      api.get('/hr/sss-contributions').then((r) => setSssContributions(r.data));
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const approveSss = async (id: string) => {
    try { await api.put(`/hr/sss-contributions/${id}/approve`); refreshAll(); toast.success('Approved'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const paySss = async (id: string) => {
    const type = prompt('Payment account (cash/bank):', 'cash') || 'cash';
    try { await api.put(`/hr/sss-contributions/${id}/pay`, { payment_account_type: type }); refreshAll(); toast.success('Paid'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const cancelSss = async (id: string) => {
    if (!window.confirm('Cancel this SSS contribution?')) return;
    try { await api.put(`/hr/sss-contributions/${id}/cancel`); refreshAll(); toast.success('Cancelled'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const tabs = [
    { key: 'employees', label: 'Employees', icon: UserCheck },
    { key: 'cash-advances', label: 'Cash Advances', icon: Wallet },
    { key: 'grocery', label: 'Grocery Credits', icon: ShoppingCart },
    { key: 'attendance', label: 'Attendance', icon: Clock },
    { key: 'attendance-sheet', label: 'Attendance Sheet', icon: FileText },
    { key: 'payroll', label: 'Payroll', icon: DollarSign },

    { key: 'sss', label: 'SSS', icon: Shield },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">HR & Payroll</h1>
        <div className="flex gap-2">
          <button onClick={refreshAll} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Refresh</button>
          {activeTab === 'employees' && <button onClick={openCreateEmployee} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Employee</button>}
          {activeTab === 'cash-advances' && <button onClick={openCashAdv} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700"><Wallet size={16} /> New Cash Advance</button>}
          {activeTab === 'grocery' && (
            <a href="/sales" className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700"><ShoppingCart size={16} /> Create in Sales Invoice</a>
          )}
          {activeTab === 'attendance' && <button onClick={openCreateAttendance} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"><Clock size={16} /> Add Attendance</button>}
          {activeTab === 'payroll' && <button onClick={openPayroll} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"><DollarSign size={16} /> Compute Payroll</button>}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${activeTab === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 hover:bg-gray-50'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ========== EMPLOYEES TAB ========== */}
      {activeTab === 'employees' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Code</th><th>Name</th><th>Position</th><th>Daily Rate</th><th>CA Balance</th><th>GC Balance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-xs">{e.employee_code}</td>
                  <td className="font-medium">{e.last_name}, {e.first_name}</td>
                  <td>{e.position || '-'}</td>
                  <td>{formatCurrency(e.daily_rate)}</td>
                  <td className="text-orange-600 font-medium">{formatCurrency(e.cash_advance_balance)}</td>
                  <td className="text-teal-600 font-medium">{formatCurrency(e.grocery_credit_balance)}</td>
                  <td><span className={`px-2 py-1 text-xs rounded-full ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{e.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openEditEmployee(e)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                      <button onClick={() => viewLedger(e.id)} className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="Ledger"><FileText size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-6">No employees yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== CASH ADVANCES TAB ========== */}
      {activeTab === 'cash-advances' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Date</th><th>Amount</th><th>Remaining</th><th>Account</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {cashAdvances.map((ca) => (
                <tr key={ca.id}>
                  <td className="font-medium">{employeeName(ca)}</td>
                  <td>{formatDate(ca.advance_date)}</td>
                  <td className="font-bold text-orange-700">{formatCurrency(ca.amount)}</td>
                  <td>{formatCurrency(ca.remaining_balance)}</td>
                  <td className="text-xs">{ca.payment_account_type || 'cash'}</td>
                  <td><span className={statusBadge(ca.status)}>{ca.status}</span></td>
                  <td>
                    {ca.status === 'Active' && (
                      <button onClick={() => cancelCashAdv(ca.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><XCircle size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
              {cashAdvances.length === 0 && <tr><td colSpan={7} className="text-center text-gray-500 py-6">No cash advances yet</td></tr>}
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

      {/* ========== ATTENDANCE TAB ========== */}
      {activeTab === 'attendance' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Date</th><th>Time In</th><th>Time Out</th><th>Status</th></tr></thead>
            <tbody>
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.last_name}, {a.first_name}</td>
                  <td>{formatDate(a.date)}</td>
                  <td>{a.time_in ? new Date(a.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                  <td>{a.time_out ? new Date(a.time_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                  <td><span className={statusBadge(a.status)}>{a.status}</span></td>
                </tr>
              ))}
              {attendance.length === 0 && <tr><td colSpan={5} className="text-center text-gray-500 py-6">No attendance records yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== PAYROLL TAB ========== */}
      {activeTab === 'payroll' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Ref #</th><th>Employee</th><th>Period</th><th>Days</th><th>Gross</th><th>CA Ded.</th><th>GC Ded.</th><th>Net Pay</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {payroll.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.payroll_number}</td>
                  <td>{p.last_name}, {p.first_name}</td>
                  <td className="text-xs">{formatDate(p.pay_period_start)} - {formatDate(p.pay_period_end)}</td>
                  <td>{p.days_worked}</td>
                  <td>{formatCurrency(p.gross_pay)}</td>
                  <td className="text-orange-600">{formatCurrency(p.cash_advance_deduction)}</td>
                  <td className="text-teal-600">{formatCurrency(p.grocery_credit_deduction)}</td>
                  <td className="font-bold">{formatCurrency(p.net_pay)}</td>
                  <td><span className={statusBadge(p.status)}>{p.status}</span></td>
                  <td>
                      <div className="flex gap-1">
                        <button onClick={() => viewPayslip(p.id)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">View</button>
                        <button onClick={() => { const t = localStorage.getItem('token'); window.open('/api/hr/payroll/' + p.id + '/print?token=' + t, '_blank'); }} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Print</button>
                        {p.status === 'Draft' && <button onClick={() => approvePayroll(p.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Approve"><CheckCircle size={14} /></button>}
                      {p.status === 'Posted' && <button onClick={() => payPayroll(p.id)} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Pay"><CreditCard size={14} /></button>}
                        {p.status !== 'Paid' && p.status !== 'Cancelled' && <button onClick={() => cancelPayroll(p.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="Cancel"><XCircle size={14} /></button>}
                        {p.status === 'Paid' && p.payment_voucher_number && <button onClick={() => { const t = localStorage.getItem('token'); window.open('/api/hr/payroll/' + p.id + '/payment-voucher/print?token=' + t, '_blank'); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="Print Payment Voucher"><Printer size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {payroll.length === 0 && <tr><td colSpan={10} className="text-center text-gray-500 py-6">No payroll records yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== SSS TAB ========== */}
      {activeTab === 'sss' && (
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
                      {sc.status === 'Draft' && <button onClick={() => approveSss(sc.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Approve"><CheckCircle size={14} /></button>}
                      {sc.status === 'Posted' && <button onClick={() => paySss(sc.id)} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Pay"><CreditCard size={14} /></button>}
                      {sc.status !== 'Paid' && sc.status !== 'Cancelled' && <button onClick={() => cancelSss(sc.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><XCircle size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {sssContributions.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-6">No SSS contributions yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== MODALS ========== */}

      {/* Employee Modal */}
      {showEmployeeModal && (
        <div className="modal-overlay" onClick={() => setShowEmployeeModal(false)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editEmployee ? 'Edit Employee' : 'Add Employee'}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1">First Name *</label><input type="text" value={empForm.first_name} onChange={(e) => setEmpForm({ ...empForm, first_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Last Name *</label><input type="text" value={empForm.last_name} onChange={(e) => setEmpForm({ ...empForm, last_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Position</label><input type="text" value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Department</label><input type="text" value={empForm.department} onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Daily Rate</label><input type="number" step="0.01" value={empForm.daily_rate} onChange={(e) => setEmpForm({ ...empForm, daily_rate: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Monthly Rate</label><input type="number" step="0.01" value={empForm.monthly_rate} onChange={(e) => setEmpForm({ ...empForm, monthly_rate: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Phone</label><input type="text" value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Employment Type</label>
                  <select value={empForm.employment_type} onChange={(e) => setEmpForm({ ...empForm, employment_type: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Regular">Regular</option><option value="Contractual">Contractual</option><option value="Probationary">Probationary</option><option value="Part-time">Part-time</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Hire Date</label><input type="date" value={empForm.hire_date || ''} onChange={(e) => setEmpForm({ ...empForm, hire_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Credit Limit</label><input type="number" step="0.01" value={empForm.credit_limit} onChange={(e) => setEmpForm({ ...empForm, credit_limit: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowEmployeeModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveEmployee} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cash Advance Modal */}
      {showCashAdvModal && (
        <div className="modal-overlay" onClick={() => setShowCashAdvModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">New Cash Advance</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Employee *</label>
                  <select value={cashAdvForm.employee_id} onChange={(e) => setCashAdvForm({ ...cashAdvForm, employee_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={cashAdvForm.amount} onChange={(e) => setCashAdvForm({ ...cashAdvForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
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
        </div>
      )}

      {/* Grocery Credit Modal */}
      {showGroceryModal && (
        <div className="modal-overlay" onClick={() => setShowGroceryModal(false)}>
          <div className="modal-content max-w-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">New Employee Grocery Credit</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div><label className="block text-sm font-medium mb-1">Employee *</label>
                  <select value={groceryForm.employee_id} onChange={(e) => setGroceryForm({ ...groceryForm, employee_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Location</label>
                  <select value={groceryForm.location_id} onChange={(e) => setGroceryForm({ ...groceryForm, location_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    <option value="1">Main Store</option><option value="2">Main Warehouse</option>
                  </select></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={groceryForm.notes} onChange={(e) => setGroceryForm({ ...groceryForm, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-sm font-medium text-gray-600">Items</span><button onClick={addGroceryItem} className="text-xs text-blue-600 hover:underline">+ Add Item</button></div>
                {groceryForm.items.map((item: any, i: number) => (
                  <div key={i} className="grid grid-cols-5 gap-2 p-2 bg-gray-50 rounded-lg items-center">
                    <input type="text" placeholder="Description" value={item.description} onChange={(e) => updateGroceryItem(i, 'description', e.target.value)} className="px-2 py-1.5 border rounded text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                    <input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => updateGroceryItem(i, 'quantity', parseFloat(e.target.value) || 0)} className="px-2 py-1.5 border rounded text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                    <input type="number" placeholder="Price" value={item.unit_price} onChange={(e) => updateGroceryItem(i, 'unit_price', parseFloat(e.target.value) || 0)} className="px-2 py-1.5 border rounded text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                    <input type="number" placeholder="Cost" value={item.cost} onChange={(e) => updateGroceryItem(i, 'cost', parseFloat(e.target.value) || 0)} className="px-2 py-1.5 border rounded text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                    <div className="flex gap-1 items-center">
                      <span className="text-xs font-medium">{(item.quantity * item.unit_price - (item.discount || 0)).toFixed(2)}</span>
                      {groceryForm.items.length > 1 && <button onClick={() => removeGroceryItem(i)} className="text-red-500"><X size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowGroceryModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveGrocery} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Modal */}
      {showAttendanceModal && (
        <div className="modal-overlay" onClick={() => setShowAttendanceModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Record Attendance</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Employee *</label>
                  <select value={attendanceForm.employee_id} onChange={(e) => setAttendanceForm({ ...attendanceForm, employee_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Date *</label><input type="date" value={attendanceForm.date} onChange={(e) => setAttendanceForm({ ...attendanceForm, date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Time In *</label><input type="time" value={attendanceForm.time_in} onChange={(e) => setAttendanceForm({ ...attendanceForm, time_in: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Time Out</label><input type="time" value={attendanceForm.time_out} onChange={(e) => setAttendanceForm({ ...attendanceForm, time_out: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAttendanceModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveAttendance} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payroll Modal */}
      {showPayrollModal && (
        <div className="modal-overlay" onClick={() => setShowPayrollModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
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
                <div><label className="block text-sm font-medium mb-1">Days Worked</label><input type="number" value={payrollForm.days_worked} onChange={(e) => setPayrollForm({ ...payrollForm, days_worked: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <p className="text-xs text-gray-500 italic">Cash advance and grocery credit deductions are auto-computed.</p>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowPayrollModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={savePayroll} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Compute</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pay Payroll Modal */}
      {showPaymentModal && (
        <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
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
                <button onClick={() => setShowPaymentModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitPayrollPayment} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Confirm Payment</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payslip Modal */}
      {showPayslipModal && payslipData && (
        <div className="modal-overlay" onClick={() => setShowPayslipModal(false)}>
          <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Payslip</h2>
                <button onClick={() => setShowPayslipModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              <div className="border-2 border-gray-300 rounded-lg">
                <div className="bg-gray-800 text-white px-6 py-4 rounded-t-lg text-center">
                  <h3 className="text-xl font-bold">D METRAN TRADING</h3>
                  <p className="text-xs text-gray-300 mt-1">Payslip - {payslipData.payroll_number}</p>
                </div>

                <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
                  <div className="p-4 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Employee</p>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Name</span><span className="font-medium">{employeeName(payslipData)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Code</span><span className="font-mono">{payslipData.employee_code}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Position</span><span>{payslipData.position || '-'}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Type</span><span>{payslipData.employment_type}</span></div>
                  </div>
                  <div className="p-4 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Pay Period</p>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Period</span><span>{formatDate(payslipData.pay_period_start)} - {formatDate(payslipData.pay_period_end)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Daily Rate</span><span>{formatCurrency(payslipData.daily_rate)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Days Worked</span><span className="font-medium">{payslipData.days_worked}</span></div>
                    <div className="flex justify-between text-sm border-t pt-1.5 mt-1.5"><span className="text-gray-500">Gross Pay</span><span className="font-bold text-lg">{formatCurrency(payslipData.gross_pay)}</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
                  <div className="p-4 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Deductions</p>
                    {payslipData.deductions.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">No deductions</p>
                    ) : (
                      payslipData.deductions.map((d: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-gray-600">{d.deduction_type}</span>
                          <span className="text-red-600">{formatCurrency(d.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between text-sm font-bold border-t pt-1.5 mt-1.5">
                      <span>Total Deductions</span>
                      <span className="text-red-600">{formatCurrency(payslipData.deductions_total)}</span>
                    </div>
                  </div>
                  <div className="p-4 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Attendance</p>
                    <div className="flex justify-between text-sm"><span className="text-green-600">Present</span><span>{payslipData.attendance.present}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-red-600">Absent</span><span>{payslipData.attendance.absent}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-yellow-600">Late</span><span>{payslipData.attendance.late}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-orange-500">Half-day</span><span>{payslipData.attendance.half_day}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-blue-600">Leave</span><span>{payslipData.attendance.leave}</span></div>
                  </div>
                </div>

                {payslipData.outstanding_balances && (payslipData.outstanding_balances.cash_advance > 0 || payslipData.outstanding_balances.grocery_credit > 0) && (
                  <div className="p-4 border-b border-gray-200 bg-amber-50">
                    <p className="text-xs font-semibold text-amber-700 uppercase mb-2">Outstanding Balances (after this payroll)</p>
                    <div className="space-y-1">
                      {payslipData.outstanding_balances.cash_advance > 0 && (
                        <div className="flex justify-between text-sm"><span className="text-orange-600">Cash Advance Balance</span><span className="font-medium text-orange-600">{formatCurrency(payslipData.outstanding_balances.cash_advance)}</span></div>
                      )}
                      {payslipData.outstanding_balances.grocery_credit > 0 && (
                        <div className="flex justify-between text-sm"><span className="text-teal-600">Grocery Credit Balance</span><span className="font-medium text-teal-600">{formatCurrency(payslipData.outstanding_balances.grocery_credit)}</span></div>
                      )}
                    </div>
                  </div>
                )}

                <div className="p-4 border-b border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Government Numbers</p>
                  <div className="grid grid-cols-4 gap-3 text-center text-sm">
                    <div><span className="text-gray-400 text-xs">SSS</span><p className="font-mono">{payslipData.sss || '-'}</p></div>
                    <div><span className="text-gray-400 text-xs">PhilHealth</span><p className="font-mono">{payslipData.philhealth || '-'}</p></div>
                    <div><span className="text-gray-400 text-xs">Pag-IBIG</span><p className="font-mono">{payslipData.pagibig || '-'}</p></div>
                    <div><span className="text-gray-400 text-xs">TIN</span><p className="font-mono">{payslipData.tin || '-'}</p></div>
                  </div>
                </div>

                <div className="bg-green-50 px-6 py-4 rounded-b-lg flex justify-between items-center">
                  <span className="text-lg font-bold text-gray-700">Net Pay</span>
                  <span className="text-2xl font-bold text-green-700">{formatCurrency(payslipData.net_pay)}</span>
                </div>
              </div>

              <div className="flex justify-end mt-4">
                <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Print</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Employee Ledger Modal */}
      {showLedgerModal && ledgerData && (
        <div className="modal-overlay" onClick={() => setShowLedgerModal(false)}>
          <div className="modal-content max-w-3xl" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}

      {/* SSS Modal */}
      {showSssModal && (
        <div className="modal-overlay" onClick={() => setShowSssModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
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
                  <div><label className="block text-sm font-medium mb-1">Employer Amount</label><input type="number" step="0.01" value={sssForm.employer_amount} onChange={(e) => setSssForm({ ...sssForm, employer_amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  <div><label className="block text-sm font-medium mb-1">Employee Amount</label><input type="number" step="0.01" value={sssForm.employee_amount} onChange={(e) => setSssForm({ ...sssForm, employee_amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowSssModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                {activeTab === 'sss' && <button onClick={openSss} className="hidden" />}
                <button onClick={saveSss} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Create</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grocery Credit Detail Modal */}
      {showGcDetailModal && gcDetail && (
        <div className="modal-overlay" onClick={() => setShowGcDetailModal(false)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}
      {/* ========== ATTENDANCE SHEET TAB ========== */}
      {activeTab === 'attendance-sheet' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium mb-1">From</label>
              <input type="date" value={sheetFrom} onChange={e => { setSheetFrom(e.target.value); }} className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">To</label>
              <input type="date" value={sheetTo} onChange={e => { setSheetTo(e.target.value); }} className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select value={sheetEmployeeId} onChange={e => { setSheetEmployeeId(e.target.value); }} className="px-3 py-2 border rounded-lg text-sm">
                <option value="">All Active</option>
                {employees.map(e => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button onClick={loadSheet} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Load</button>
              <button onClick={saveSheet} disabled={sheetSaving || Object.keys(sheetChanges).length === 0} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">{sheetSaving ? 'Saving...' : `Save (${Object.keys(sheetChanges).length})`}</button>
              <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/hr/attendance/sheet/print?from=${sheetFrom}&to=${sheetTo}&employee_id=${sheetEmployeeId}&token=${t}`, '_blank'); }} className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700">Print</button>
            </div>
          </div>

          {sheetData && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="text-xs border-collapse w-max min-w-full">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="sticky left-0 bg-gray-100 px-3 py-2 text-left font-semibold border-r z-10" style={{minWidth:180}}>Employee</th>
                    {sheetData.dates.map((dt: string) => {
                      const d = new Date(dt);
                      return <th key={dt} className="px-2 py-2 text-center font-semibold border-r" style={{minWidth:55}}>
                        <div className="text-[10px] text-gray-500">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</div>
                        <div>{d.getDate()}</div>
                      </th>;
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
                          <td key={dt} className="px-1 py-1 text-center border-r cursor-pointer hover:ring-2 hover:ring-blue-400"
                            onClick={() => toggleSheetStatus(e.id, dt, status)}>
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
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="sticky left-0 bg-gray-50 px-3 py-1.5 border-r z-10">TOTALS</td>
                    {sheetData.dates.map((dt: string) => {
                      let count = 0; let has = false;
                      for (const e of sheetData.employees) {
                        const key = `${e.id}_${dt}`;
                        const changed = sheetChanges[key];
                        const rec = e.days[dt];
                        const status = changed !== undefined ? (changed || null) : rec?.status;
                        if (status && status !== 'Absent' && status !== 'Leave') { count += status === 'Half-day' ? 0.5 : 1; has = true; }
                      }
                      return <td key={dt} className="px-2 py-1 text-center border-r text-gray-600">{has ? count : ''}</td>;
                    })}
                    <td className="px-2 py-1 text-center border-l-2"></td><td></td><td></td><td></td><td></td><td></td><td></td>
                  </tr>
                </tbody>
              </table>
              <div className="px-4 py-2 border-t bg-gray-50 text-[10px] text-gray-500 flex gap-4">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block"></span> Present</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block"></span> Absent</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 inline-block"></span> Late</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 inline-block"></span> Half-day</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-200 inline-block"></span> Leave</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-300 inline-block"></span> Rest Day</span>
                <span className="ml-4 text-gray-400">Click cell to cycle status | Blue outline = unsaved</span>
              </div>
            </div>
          )}
          {!sheetData && <div className="text-center py-12 text-gray-400">Click "Load" to generate the attendance sheet</div>}
        </div>
      )}
    </div>
  );
}
