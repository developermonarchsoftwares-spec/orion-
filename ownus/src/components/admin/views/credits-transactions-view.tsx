'use client';

import React, { useState } from 'react';
import { 
  Coins, 
  Search, 
  Download, 
  ArrowUpRight, 
  ArrowDownLeft, 
  PlusCircle, 
  RefreshCw, 
  Clock, 
  CheckCircle2, 
  SlidersHorizontal,
  CreditCard,
  RotateCcw,
  Ban,
  FileText,
  AlertCircle,
  Eye,
  Check,
  XCircle,
  TrendingUp,
  Receipt
} from 'lucide-react';
import { 
  TransactionRecord, 
  PaymentStatus, 
  CustomerPlan 
} from '@/types/admin';
import { generateInvoicePdf } from '@/lib/invoice-generator';

interface CreditsTransactionsViewProps {
  transactions: TransactionRecord[];
  onAddTransaction: (tx: Omit<TransactionRecord, 'id' | 'date' | 'receiptNumber'>) => void;
  onUpdateTransactionStatus?: (id: string, newStatus: PaymentStatus, reason?: string) => void;
}

export const CreditsTransactionsView: React.FC<CreditsTransactionsViewProps> = ({
  transactions,
  onAddTransaction,
  onUpdateTransactionStatus,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedMethod, setSelectedMethod] = useState<string>('ALL');
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [selectedTxForDetail, setSelectedTxForDetail] = useState<TransactionRecord | null>(null);
  const [refundTx, setRefundTx] = useState<TransactionRecord | null>(null);
  const [refundReason, setRefundReason] = useState('Customer reported invalid lead phone numbers');

  // Manual allocation form state
  const [targetCustomer, setTargetCustomer] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [targetPlan, setTargetPlan] = useState<CustomerPlan>('Starter');
  const [creditsPurchased, setCreditsPurchased] = useState<number>(100);
  const [amountPaid, setAmountPaid] = useState<number>(99);
  const [paymentMethod, setPaymentMethod] = useState<TransactionRecord['paymentMethod']>('Razorpay UPI');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Success');

  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch = 
      tx.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.customerEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.receiptNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === 'ALL' || tx.paymentStatus === selectedStatus;
    const matchesMethod = selectedMethod === 'ALL' || tx.paymentMethod === selectedMethod;
    return matchesSearch && matchesStatus && matchesMethod;
  });

  // KPI Dashboard computations
  const creditsPurchasedToday = transactions.reduce((acc, t) => acc + (t.creditsPurchased || 0), 0);
  const creditsUsedToday = transactions.reduce((acc, t) => acc + (t.creditsUsed || 0), 0);
  const remainingCredits = transactions.reduce((acc, t) => acc + (t.creditsPurchased - t.creditsUsed), 0);
  const revenueToday = transactions.filter(t => t.paymentStatus === 'Success').reduce((acc, t) => acc + (t.amount || 0), 0);
  const pendingPayments = transactions.filter(t => t.paymentStatus === 'Pending').length;
  const refundRequests = transactions.filter(t => t.paymentStatus === 'Refunded').length;

  const handleCreateTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    onAddTransaction({
      customerId: 'CUST-' + Math.floor(1000 + Math.random() * 9000),
      customerName: targetCustomer.trim(),
      customerEmail: targetEmail.trim(),
      company: targetCompany.trim(),
      plan: targetPlan,
      creditsPurchased,
      creditsUsed: 0,
      amount: amountPaid,
      paymentMethod,
      paymentStatus,
    });
    setShowAllocateModal(false);
  };

  const handleConfirmRefund = () => {
    if (!refundTx || !onUpdateTransactionStatus) return;
    onUpdateTransactionStatus(refundTx.id, 'Refunded', refundReason);
    setRefundTx(null);
  };

  const handleCancelTransaction = (tx: TransactionRecord) => {
    if (!onUpdateTransactionStatus) return;
    onUpdateTransactionStatus(tx.id, 'Cancelled', 'Cancelled by administrator');
  };

  const handleDownloadInvoice = (tx: TransactionRecord) => {
    generateInvoicePdf(tx);
  };

  const handleExportCSV = () => {
    const headers = ['Transaction ID', 'Receipt No', 'Customer Name', 'Company', 'Plan', 'Credits Purchased', 'Credits Used', 'Amount (INR)', 'Payment Method', 'Payment Status', 'Date'];
    const rows = filteredTransactions.map(tx => [
      tx.id,
      tx.receiptNumber,
      `"${tx.customerName}"`,
      `"${tx.company}"`,
      tx.plan || 'Starter',
      tx.creditsPurchased,
      tx.creditsUsed,
      tx.amount,
      `"${tx.paymentMethod}"`,
      tx.paymentStatus,
      `"${tx.date}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `orion_transactions_ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'Success':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700"><CheckCircle2 className="w-3 h-3 text-zinc-300" /> Success</span>;
      case 'Pending':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700"><Clock className="w-3 h-3 text-zinc-400" /> Pending</span>;
      case 'Failed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800"><XCircle className="w-3 h-3 text-zinc-400" /> Failed</span>;
      case 'Refunded':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800/80 text-zinc-300 border border-zinc-700"><RotateCcw className="w-3 h-3 text-zinc-300" /> Refunded</span>;
      case 'Cancelled':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800"><Ban className="w-3 h-3 text-zinc-400" /> Cancelled</span>;
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Coins className="w-5 h-5 text-zinc-300" />
            Credits Economy & Financial Transactions
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Complete credit ledger tracking purchases, wallet balances, payment gateways, GST invoices, and refund workflows.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
          >
            <Download className="w-4 h-4" />
            Export Ledger
          </button>
          <button
            onClick={() => setShowAllocateModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow"
          >
            <PlusCircle className="w-4 h-4" />
            Record Transaction
          </button>
        </div>
      </div>

      {/* 6 Credit Economy Dashboard Widgets */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Purchased Today</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">+{creditsPurchasedToday.toLocaleString()}</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <ArrowUpRight className="w-3 h-3 text-zinc-300" /> Units minted
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Used Today</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">-{creditsUsedToday.toLocaleString()}</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <ArrowDownLeft className="w-3 h-3 text-zinc-400" /> Leads unlocked
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Remaining Pool</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">{remainingCredits.toLocaleString()}</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            In user wallets
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Revenue Today</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">₹{revenueToday.toLocaleString()}</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            Razorpay + UPI
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Pending Payments</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">{pendingPayments}</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            Awaiting gateway
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Refund Requests</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">{refundRequests}</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            Audited & logged
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search transaction ID, customer, receipt..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Payment Statuses</option>
            <option value="Success">Success</option>
            <option value="Pending">Pending</option>
            <option value="Failed">Failed</option>
            <option value="Refunded">Refunded</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <select
            value={selectedMethod}
            onChange={e => setSelectedMethod(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Payment Methods</option>
            <option value="Razorpay UPI">Razorpay UPI</option>
            <option value="Credit Card">Credit Card</option>
            <option value="NetBanking">NetBanking</option>
            <option value="Bank Wire">Bank Wire</option>
          </select>
        </div>
      </div>

      {/* Transactions Data Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-xs uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">Transaction & Receipt</th>
                <th className="py-3.5 px-4">Customer & Plan</th>
                <th className="py-3.5 px-4 text-right">Credits Purchased</th>
                <th className="py-3.5 px-4 text-right">Amount (₹)</th>
                <th className="py-3.5 px-4">Payment Method</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Date & Time</th>
                <th className="py-3.5 px-4 text-right">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500 font-sans">
                    <Coins className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No transactions match the selected filter criteria.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-zinc-200">{tx.id}</div>
                      <div className="text-[11px] text-zinc-400">{tx.receiptNumber}</div>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      <div className="font-semibold text-zinc-100">{tx.customerName}</div>
                      <div className="text-xs text-zinc-400">{tx.company} • {tx.plan || 'Starter'}</div>
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <span className="font-bold text-zinc-100">
                        +{tx.creditsPurchased.toLocaleString()}
                      </span>
                      <div className="text-[10px] text-zinc-400">{tx.creditsUsed} used</div>
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="font-bold text-zinc-100 text-sm">
                        ₹{tx.amount.toLocaleString()}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-sans text-xs text-zinc-300">
                      {tx.paymentMethod}
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      {getStatusBadge(tx.paymentStatus)}
                    </td>

                    <td className="py-3.5 px-4 text-zinc-400 text-xs">
                      {tx.date}
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedTxForDetail(tx)}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                          title="View Transaction Breakdown"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleDownloadInvoice(tx)}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                          title="Download Tax Invoice"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                        </button>

                        {tx.paymentStatus === 'Success' && (
                          <button
                            onClick={() => setRefundTx(tx)}
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
                            title="Issue Refund"
                          >
                            Refund
                          </button>
                        )}

                        {tx.paymentStatus === 'Pending' && (
                          <button
                            onClick={() => handleCancelTransaction(tx)}
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition"
                            title="Cancel Pending Invoice"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Transaction Breakdown Modal */}
      {selectedTxForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-zinc-300" />
                Transaction Breakdown
              </h3>
              <button
                onClick={() => setSelectedTxForDetail(null)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-zinc-800/60 font-mono">
                <span className="text-zinc-400 font-sans">Transaction ID</span>
                <span className="text-zinc-200 font-bold">{selectedTxForDetail.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60 font-mono">
                <span className="text-zinc-400 font-sans">Receipt Number</span>
                <span className="text-zinc-200">{selectedTxForDetail.receiptNumber}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Customer</span>
                <span className="text-zinc-200 font-semibold">{selectedTxForDetail.customerName} ({selectedTxForDetail.company})</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Credits Package</span>
                <span className="text-zinc-200 font-bold">{selectedTxForDetail.creditsPurchased.toLocaleString()} Credits</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Total Billed</span>
                <span className="text-zinc-100 font-bold text-sm">₹{selectedTxForDetail.amount.toLocaleString()} (Incl. 18% GST)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Payment Gateway</span>
                <span className="text-zinc-300">{selectedTxForDetail.paymentMethod}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Status</span>
                <span>{getStatusBadge(selectedTxForDetail.paymentStatus)}</span>
              </div>
              <div className="flex justify-between py-1 font-mono">
                <span className="text-zinc-400 font-sans">Timestamp</span>
                <span className="text-zinc-400">{selectedTxForDetail.date}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <button
                onClick={() => handleDownloadInvoice(selectedTxForDetail)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Download Invoice
              </button>
              <button
                onClick={() => setSelectedTxForDetail(null)}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue Refund Modal */}
      {refundTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-zinc-300" />
                Issue Payment Refund
              </h3>
              <button
                onClick={() => setRefundTx(null)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="text-sm text-zinc-300">
              Refunding <strong className="text-zinc-100">₹{refundTx.amount.toLocaleString()}</strong> for transaction <span className="font-mono">{refundTx.id}</span> ({refundTx.customerName}).
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Audit Reason for Refund
              </label>
              <textarea
                rows={2}
                value={refundReason}
                onChange={e => setRefundReason(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 resize-none"
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefundTx(null)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRefund}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition"
              >
                Confirm Refund
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Transaction Recording Modal */}
      {showAllocateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-zinc-300" />
                Record Transaction / Purchase
              </h3>
              <button
                onClick={() => setShowAllocateModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Customer Full Name</label>
                  <input
                    type="text"
                    required
                    value={targetCustomer}
                    onChange={e => setTargetCustomer(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Company / Organization</label>
                  <input
                    type="text"
                    required
                    value={targetCompany}
                    onChange={e => setTargetCompany(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Corporate Email</label>
                  <input
                    type="email"
                    required
                    value={targetEmail}
                    onChange={e => setTargetEmail(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Subscription Plan</label>
                  <select
                    value={targetPlan}
                    onChange={e => setTargetPlan(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  >
                    <option value="Starter">Starter</option>
                    <option value="Professional">Professional</option>
                    <option value="Growth">Growth</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Credits Minted</label>
                  <input
                    type="number"
                    min={1}
                    value={creditsPurchased}
                    onChange={e => setCreditsPurchased(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Amount Paid (₹ INR)</label>
                  <input
                    type="number"
                    min={0}
                    value={amountPaid}
                    onChange={e => setAmountPaid(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  >
                    <option value="Razorpay UPI">Razorpay UPI</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="NetBanking">NetBanking</option>
                    <option value="Bank Wire">Bank Wire</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Payment Status</label>
                  <select
                    value={paymentStatus}
                    onChange={e => setPaymentStatus(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  >
                    <option value="Success">Success</option>
                    <option value="Pending">Pending</option>
                    <option value="Failed">Failed</option>
                    <option value="Refunded">Refunded</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAllocateModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition"
                >
                  Record & Generate Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
