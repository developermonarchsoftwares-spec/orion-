'use client';

import React, { useState } from 'react';
import { 
  CustomerUser, 
  CustomerPlan,
  CustomerUserStatus 
} from '@/types/admin';
import { 
  X, 
  User, 
  Building2, 
  CreditCard, 
  Coins, 
  History, 
  Search, 
  Shield, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  AlertCircle,
  Key,
  Lock,
  Unlock,
  Trash2,
  TrendingUp,
  FileText,
  Smartphone,
  Mail,
  Receipt
} from 'lucide-react';

interface UserProfileModalProps {
  user: CustomerUser | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateUser: (updatedUser: CustomerUser) => void;
  onDeleteUser: (userId: string) => void;
  onAdjustCredits: (user: CustomerUser, amount: number) => void;
  onUpgradePlan: (user: CustomerUser, newPlan: CustomerPlan) => void;
  onResetPassword: (user: CustomerUser) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  user,
  isOpen,
  onClose,
  onUpdateUser,
  onDeleteUser,
  onAdjustCredits,
  onUpgradePlan,
  onResetPassword,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'subscription' | 'unlocked' | 'searches' | 'logins' | 'timeline'>('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('');
  const [creditAdjustment, setCreditAdjustment] = useState(100);
  const [showCreditAdjustBox, setShowCreditAdjustBox] = useState(false);
  const [showUpgradeBox, setShowUpgradeBox] = useState(false);
  const [selectedNewPlan, setSelectedNewPlan] = useState<CustomerPlan>('Enterprise');

  React.useEffect(() => {
    if (user) {
      setEditName(user.name);
      setEditCompany(user.company);
      setEditEmail(user.email);
      setEditPhone(user.phone);
      setEditRole(user.role);
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateUser({
      ...user,
      name: editName,
      company: editCompany,
      email: editEmail,
      phone: editPhone,
      role: editRole,
    });
    setIsEditing(false);
  };

  const toggleStatus = () => {
    const newStatus: CustomerUserStatus = user.status === 'Active' ? 'Suspended' : 'Active';
    onUpdateUser({
      ...user,
      status: newStatus,
    });
  };

  const handleApplyCredits = () => {
    onAdjustCredits(user, creditAdjustment);
    setShowCreditAdjustBox(false);
  };

  const handleApplyUpgrade = () => {
    onUpgradePlan(user, selectedNewPlan);
    setShowUpgradeBox(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans text-zinc-100">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-bold text-zinc-200">
              {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-100">{user.name}</h2>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                  user.status === 'Active' 
                    ? 'bg-zinc-800 text-zinc-100 border-zinc-700' 
                    : user.status === 'Suspended' 
                    ? 'bg-zinc-900 text-zinc-400 border-zinc-700' 
                    : 'bg-zinc-800/40 text-zinc-400 border-zinc-800'
                }`}>
                  {user.status}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {user.plan} Plan
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">{user.company} • {user.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(prev => !prev)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
            >
              {isEditing ? 'Cancel Edit' : 'Edit Profile'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-800 px-5 gap-4 bg-zinc-950/40 text-xs overflow-x-auto">
          {[
            { id: 'profile', label: 'Personal & Company', icon: User },
            { id: 'subscription', label: 'Subscription & Credits', icon: CreditCard },
            { id: 'unlocked', label: `Unlocked Leads (${user.unlockedBusinesses?.length || 0})`, icon: Building2 },
            { id: 'searches', label: `Saved Searches (${user.savedSearches?.length || 0})`, icon: Search },
            { id: 'logins', label: 'Login History', icon: Shield },
            { id: 'timeline', label: 'Activity Audit', icon: Clock },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 font-medium border-b-2 flex items-center gap-1.5 whitespace-nowrap transition ${
                  isActive
                    ? 'border-zinc-200 text-zinc-100 font-bold'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Tab 1: Profile & Company Information */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              {isEditing ? (
                <form onSubmit={handleSaveProfile} className="space-y-4 bg-zinc-950 border border-zinc-800 rounded-xl p-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Edit Customer Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Company / Organization</label>
                      <input
                        type="text"
                        value={editCompany}
                        onChange={e => setEditCompany(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
                      <input
                        type="email"
                        value={editEmail}
                        onChange={e => setEditEmail(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Phone Number</label>
                      <input
                        type="text"
                        value={editPhone}
                        onChange={e => setEditPhone(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Designation / Role</label>
                      <input
                        type="text"
                        value={editRole}
                        onChange={e => setEditRole(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white"
                    >
                      Save Profile Changes
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Personal Details */}
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" /> Personal Information
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400">User ID</span>
                        <span className="font-mono text-zinc-200">{user.id}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400">Full Name</span>
                        <span className="font-semibold text-zinc-200">{user.name}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400">Corporate Email</span>
                        <span className="font-mono text-zinc-200">{user.email}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400">Phone Number</span>
                        <span className="font-mono text-zinc-200">{user.phone}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400">Designation</span>
                        <span className="text-zinc-200">{user.role}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-zinc-400">Registered Date</span>
                        <span className="font-mono text-zinc-200">{user.registeredDate}</span>
                      </div>
                    </div>
                  </div>

                  {/* Company & Billing Details */}
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" /> Company & Billing
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400">Company Name</span>
                        <span className="font-semibold text-zinc-200">{user.company}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400">GSTIN / Tax ID</span>
                        <span className="font-mono text-zinc-200">{user.billingAddress?.gstin || 'Not Provided'}</span>
                      </div>
                      <div className="py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-400 block mb-1">Billing Address</span>
                        <span className="text-zinc-300 leading-relaxed block">
                          {user.billingAddress ? `${user.billingAddress.street}, ${user.billingAddress.city}, ${user.billingAddress.state} - ${user.billingAddress.pincode}` : 'No address on file'}
                        </span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-zinc-400">Last Active Session</span>
                        <span className="font-mono text-zinc-200">{user.lastLogin}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Administrative Action Bar */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-zinc-400 font-medium">
                  Administrative User Controls
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => onResetPassword(user)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition flex items-center gap-1.5"
                  >
                    <Key className="w-3.5 h-3.5" /> Reset Password
                  </button>

                  <button
                    onClick={toggleStatus}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition flex items-center gap-1.5"
                  >
                    {user.status === 'Active' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    {user.status === 'Active' ? 'Suspend Access' : 'Activate Access'}
                  </button>

                  <button
                    onClick={() => onDeleteUser(user.id)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 border border-zinc-700 transition flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete User
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Subscription & Credits */}
          {activeTab === 'subscription' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                  <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Active Plan</div>
                  <div className="text-xl font-bold text-zinc-100 mt-1">{user.plan}</div>
                  <div className="text-xs text-zinc-400 mt-1">
                    Billed annually
                  </div>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                  <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Credits Balance</div>
                  <div className="text-xl font-bold text-zinc-100 mt-1">{user.credits.toLocaleString()}</div>
                  <div className="text-xs text-zinc-400 mt-1 font-mono">
                    {user.unlockedCount} unlocked leads
                  </div>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                  <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Lifetime Spend</div>
                  <div className="text-xl font-bold text-zinc-100 mt-1">₹{user.totalSpent.toLocaleString()}</div>
                  <div className="text-xs text-zinc-400 mt-1">
                    Gross revenue generated
                  </div>
                </div>
              </div>

              {/* Action Box: Adjust Credits or Upgrade Plan */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Adjust Credits Box */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5" /> Adjust Credits Pool
                  </h4>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={creditAdjustment}
                      onChange={e => setCreditAdjustment(Number(e.target.value))}
                      placeholder="Amount (+ or -)"
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={handleApplyCredits}
                      className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white transition"
                    >
                      Post Adjustment
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Directly modifies wallet balance and logs a compliance record in the credit ledger.
                  </p>
                </div>

                {/* Upgrade Plan Box */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Modify Subscription Tier
                  </h4>
                  <div className="flex gap-2">
                    <select
                      value={selectedNewPlan}
                      onChange={e => setSelectedNewPlan(e.target.value as any)}
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                    >
                      <option value="Starter">Starter</option>
                      <option value="Professional">Professional</option>
                      <option value="Growth">Growth</option>
                      <option value="Enterprise">Enterprise</option>
                    </select>
                    <button
                      onClick={handleApplyUpgrade}
                      className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white transition"
                    >
                      Change Plan
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Updates feature entitlements, monthly unlock allowances, and export limits.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Unlocked Businesses */}
          {activeTab === 'unlocked' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Unlocked Business Records ({user.unlockedBusinesses?.length || 0})
              </h3>
              {(!user.unlockedBusinesses || user.unlockedBusinesses.length === 0) ? (
                <div className="p-8 text-center bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-500 text-xs">
                  No businesses unlocked by this user yet.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-900 text-zinc-400 font-semibold border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3">Business Name</th>
                        <th className="py-2.5 px-3">Industry</th>
                        <th className="py-2.5 px-3">Location</th>
                        <th className="py-2.5 px-3">Unlocked At</th>
                        <th className="py-2.5 px-3 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-mono">
                      {user.unlockedBusinesses.map(b => (
                        <tr key={b.id} className="hover:bg-zinc-900/40">
                          <td className="py-2.5 px-3 font-sans font-semibold text-zinc-200">{b.name}</td>
                          <td className="py-2.5 px-3 font-sans text-zinc-400">{b.industry}</td>
                          <td className="py-2.5 px-3 font-sans text-zinc-400">{b.city}, {b.state}</td>
                          <td className="py-2.5 px-3 text-zinc-400">{b.unlockedAt}</td>
                          <td className="py-2.5 px-3 text-right font-bold text-zinc-200">{b.creditsCost} cr</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Saved Searches */}
          {activeTab === 'searches' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Saved Search Filters ({user.savedSearches?.length || 0})
              </h3>
              {(!user.savedSearches || user.savedSearches.length === 0) ? (
                <div className="p-8 text-center bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-500 text-xs">
                  No saved searches recorded for this customer.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {user.savedSearches.map(s => (
                    <div key={s.id} className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2 text-xs">
                      <div className="flex justify-between items-center font-semibold text-zinc-200">
                        <span>{s.name}</span>
                        <span className="font-mono text-zinc-400">{s.resultCount} matches</span>
                      </div>
                      <div className="p-2 bg-zinc-900 rounded-lg text-[11px] font-mono text-zinc-400 space-y-0.5">
                        {Object.entries(s.filters).map(([k, v]) => (
                          <div key={k}>{k}: <span className="text-zinc-200">{v}</span></div>
                        ))}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">Saved on {s.savedAt}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Login History */}
          {activeTab === 'logins' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Authentication & Session Logs
              </h3>
              {(!user.loginHistory || user.loginHistory.length === 0) ? (
                <div className="p-8 text-center bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-500 text-xs">
                  No authentication logs captured.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-zinc-900 text-zinc-400 font-semibold border-b border-zinc-800 font-sans">
                      <tr>
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">IP Address</th>
                        <th className="py-2.5 px-3">Device / OS</th>
                        <th className="py-2.5 px-3">Location</th>
                        <th className="py-2.5 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {user.loginHistory.map(l => (
                        <tr key={l.id} className="hover:bg-zinc-900/40">
                          <td className="py-2.5 px-3 text-zinc-300">{l.timestamp}</td>
                          <td className="py-2.5 px-3 text-zinc-400">{l.ip}</td>
                          <td className="py-2.5 px-3 font-sans text-zinc-300">{l.device} • {l.browser}</td>
                          <td className="py-2.5 px-3 font-sans text-zinc-400">{l.location}</td>
                          <td className="py-2.5 px-3 text-right font-sans">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-200 border border-zinc-700">
                              {l.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Tab 6: Activity Timeline */}
          {activeTab === 'timeline' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Audited Platform Activity
              </h3>
              {(!user.activityTimeline || user.activityTimeline.length === 0) ? (
                <div className="p-8 text-center bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-500 text-xs">
                  No activity timeline events recorded.
                </div>
              ) : (
                <div className="space-y-3">
                  {user.activityTimeline.map(evt => (
                    <div key={evt.id} className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-zinc-200">{evt.action}</span>
                        <span className="font-mono text-[10px] text-zinc-400">{evt.timestamp}</span>
                      </div>
                      <p className="text-zinc-400 text-[11px] leading-relaxed">
                        {evt.details}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-800 flex justify-end bg-zinc-950/60">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
          >
            Close Profile
          </button>
        </div>
      </div>
    </div>
  );
};
