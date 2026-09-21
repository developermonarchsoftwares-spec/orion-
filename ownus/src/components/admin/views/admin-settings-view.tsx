'use client';

import React, { useState } from 'react';
import { 
  Settings, 
  Tag, 
  Layers, 
  Sliders, 
  ShieldAlert, 
  Plus, 
  Trash2, 
  Check, 
  RotateCcw, 
  Save, 
  Database,
  Building,
  CheckCircle2,
  CreditCard,
  Mail,
  Bell,
  Globe,
  Coins,
  MapPin,
  FileCheck2,
  SlidersHorizontal
} from 'lucide-react';
import { CreditPackage, SubscriptionPlan } from '@/types/admin';
import { INITIAL_CREDIT_PACKAGES, INITIAL_SUBSCRIPTION_PLANS } from '@/lib/admin-mock-data';

import { AdminFilterManager } from '@/components/admin/views/admin-filter-manager';

export const AdminSettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'filter_manager' | 'taxonomy' | 'locations' | 'economy' | 'rules' | 'templates' | 'app_settings'
  >('filter_manager');
  const [savedToast, setSavedToast] = useState(false);

  // 1. Taxonomies & Masters
  const [industries, setIndustries] = useState<string[]>([
    'Manufacturing & Industrial Supplies',
    'IT & Software Development',
    'Logistics, Warehousing & Supply Chain',
    'Healthcare, Medical & Pharma',
    'Textiles & Garment Manufacturing',
    'Food Processing & Agro Commodities',
    'Chemicals, Petrochemicals & Polymers',
    'Construction, Civil & Interior Design',
    'Electrical & Electronics',
    'Financial, Legal & Corporate Advisory',
  ]);
  const [newIndustry, setNewIndustry] = useState('');

  const [categories, setCategories] = useState<string[]>([
    'CNC & Precision Machining',
    'Cloud ERP & CRM Systems',
    'Cold Storage & Refrigerated Transport',
    'Diagnostic & Surgical Equipment',
    'Synthetic & Organic Cotton Weaving',
    'Industrial Packaging & Corrugated Boxes',
  ]);
  const [newCategory, setNewCategory] = useState('');

  const [subIndustries, setSubIndustries] = useState<string[]>([
    'Die Casting & Tooling',
    'SaaS Billing & Subscription Gateways',
    'Last-Mile Fleet Telematics',
    'Active Pharmaceutical Ingredients (API)',
    'Yarn Spinning & Dyeing',
    'Injection Moulding & Polymers'
  ]);
  const [newSubIndustry, setNewSubIndustry] = useState('');

  const [msmeCategories, setMsmeCategories] = useState<string[]>([
    'Micro (Investment < ₹1 Cr, Turnover < ₹5 Cr)',
    'Small (Investment < ₹10 Cr, Turnover < ₹50 Cr)',
    'Medium (Investment < ₹50 Cr, Turnover < ₹250 Cr)',
    'Unregistered / Large Commercial Enterprise',
  ]);

  const [businessTypes, setBusinessTypes] = useState<string[]>([
    'Private Limited (Pvt Ltd)',
    'Public Limited',
    'Limited Liability Partnership (LLP)',
    'Sole Proprietorship',
    'Partnership Firm',
    'One Person Company (OPC)',
  ]);

  // 2. Locations Master
  const [states, setStates] = useState<string[]>([
    'Maharashtra', 'Karnataka', 'Tamil Nadu', 'Gujarat', 'Telangana', 'Delhi NCR', 'Haryana', 'West Bengal', 'Punjab', 'Kerala', 'Rajasthan', 'Uttar Pradesh'
  ]);
  const [districts, setDistricts] = useState<string[]>([
    'Pune', 'Bengaluru Urban', 'Mumbai Suburban', 'Chennai', 'Ahmedabad', 'Hyderabad', 'Gurugram', 'Kolkata', 'Ludhiana', 'Ernakulam'
  ]);
  const [cities, setCities] = useState<string[]>([
    'Pune', 'Bengaluru', 'Mumbai', 'Navi Mumbai', 'Chennai', 'Ahmedabad', 'Surat', 'Hyderabad', 'Gurugram', 'Noida', 'Kolkata', 'Ludhiana', 'Kochi', 'Jaipur'
  ]);

  // 3. Economy & Plans
  const [creditPacks, setCreditPacks] = useState<CreditPackage[]>(INITIAL_CREDIT_PACKAGES);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>(INITIAL_SUBSCRIPTION_PLANS);

  // 4. Validation & Import Rules
  const [strictPhoneValidation, setStrictPhoneValidation] = useState(true);
  const [strictEmailMXCheck, setStrictEmailMXCheck] = useState(true);
  const [requirePincodeVerification, setRequirePincodeVerification] = useState(true);
  const [duplicateNameThreshold, setDuplicateNameThreshold] = useState(85);
  const [autoQuarantineDuplicates, setAutoQuarantineDuplicates] = useState(true);
  const [maxBatchUploadSizeMB, setMaxBatchUploadSizeMB] = useState(250);
  const [autoMapColumns, setAutoMapColumns] = useState(true);
  const [allowPartialBatchIngest, setAllowPartialBatchIngest] = useState(true);
  const [defaultDraftOnIngest, setDefaultDraftOnIngest] = useState(true);

  // 5. Templates
  const [emailTemplates, setEmailTemplates] = useState([
    { id: 'tmpl-1', name: 'Welcome & Account Activation', subject: 'Welcome to Orion Lead Intelligence platform', trigger: 'User Signup' },
    { id: 'tmpl-2', name: 'Low Credit Balance Alert', subject: 'Action Required: Your Orion credit balance is below 50 credits', trigger: 'Credits < 50' },
    { id: 'tmpl-3', name: 'Batch Ingestion Summary', subject: 'Ingestion Report: [Batch ID] completed validation', trigger: 'Import Complete' },
    { id: 'tmpl-4', name: 'Password Reset Request', subject: 'Reset your Orion Account Password', trigger: 'Password Reset' },
    { id: 'tmpl-5', name: 'Support Ticket Update', subject: 'Update on Support Ticket [Ticket ID]', trigger: 'Agent Reply' }
  ]);

  // 6. Application Settings
  const [platformName, setPlatformName] = useState('Orion Lead Intelligence Platform');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Kolkata (IST +5:30)');
  const [currency, setCurrency] = useState('INR (₹)');
  const [defaultCreditsOnSignup, setDefaultCreditsOnSignup] = useState(50);
  const [defaultUserRole, setDefaultUserRole] = useState('Starter Subscriber');

  const handleAddIndustry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIndustry.trim() || industries.includes(newIndustry.trim())) return;
    setIndustries([...industries, newIndustry.trim()]);
    setNewIndustry('');
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategory.trim() || categories.includes(newCategory.trim())) return;
    setCategories([...categories, newCategory.trim()]);
    setNewCategory('');
  };

  const handleAddSubIndustry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubIndustry.trim() || subIndustries.includes(newSubIndustry.trim())) return;
    setSubIndustries([...subIndustries, newSubIndustry.trim()]);
    setNewSubIndustry('');
  };

  const handleSaveSettings = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-zinc-300" />
            Platform & Data Governance Settings
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Configure system master taxonomies, location registries, credit packs, subscription pricing, pipeline rules, and application settings.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {savedToast && (
            <span className="text-xs font-semibold text-zinc-200 bg-zinc-800 border border-zinc-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-zinc-300" /> Configuration Saved
            </span>
          )}
          <button
            onClick={handleSaveSettings}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-zinc-800 gap-2 overflow-x-auto text-xs">
        {[
          { id: 'filter_manager', label: 'User Page Filter Manager', icon: SlidersHorizontal },
          { id: 'taxonomy', label: 'Master Taxonomies', icon: Tag },
          { id: 'locations', label: 'Location Masters', icon: MapPin },
          { id: 'economy', label: 'Credit Packages & Plans', icon: CreditCard },
          { id: 'rules', label: 'Validation & Import Rules', icon: ShieldAlert },
          { id: 'templates', label: 'Email & Notifications', icon: Mail },
          { id: 'app_settings', label: 'Application Settings', icon: Globe },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 px-3.5 font-medium border-b-2 transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
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

      {/* Tab 0: User Page Filter Options Governance */}
      {activeTab === 'filter_manager' && <AdminFilterManager />}

      {/* Tab 1: Taxonomies */}
      {activeTab === 'taxonomy' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Industries */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Building className="w-4 h-4 text-zinc-300" />
                Industry Sectors ({industries.length})
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">Primary industry groupings recognized in Discover search</p>
            </div>

            <form onSubmit={handleAddIndustry} className="flex gap-2">
              <input
                type="text"
                value={newIndustry}
                onChange={e => setNewIndustry(e.target.value)}
                placeholder="Add new industry sector..."
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </form>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {industries.map(ind => (
                <div key={ind} className="flex items-center justify-between p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg text-xs text-zinc-200">
                  <span className="font-medium">{ind}</span>
                  <button
                    onClick={() => setIndustries(industries.filter(i => i !== ind))}
                    className="text-zinc-500 hover:text-zinc-300 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Sub Industries */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-zinc-300" />
                Sub Industries ({subIndustries.length})
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">Micro vertical classifications</p>
            </div>

            <form onSubmit={handleAddSubIndustry} className="flex gap-2">
              <input
                type="text"
                value={newSubIndustry}
                onChange={e => setNewSubIndustry(e.target.value)}
                placeholder="Add sub-industry..."
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </form>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {subIndustries.map(sub => (
                <div key={sub} className="flex items-center justify-between p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg text-xs text-zinc-200">
                  <span className="font-medium">{sub}</span>
                  <button
                    onClick={() => setSubIndustries(subIndustries.filter(s => s !== sub))}
                    className="text-zinc-500 hover:text-zinc-300 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Business Categories */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Tag className="w-4 h-4 text-zinc-300" />
                Business Categories ({categories.length})
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">Specialized niche classifications for lead intelligence</p>
            </div>

            <form onSubmit={handleAddCategory} className="flex gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                placeholder="Add category..."
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </form>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {categories.map(cat => (
                <div key={cat} className="flex items-center justify-between p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg text-xs text-zinc-200">
                  <span className="font-medium">{cat}</span>
                  <button
                    onClick={() => setCategories(categories.filter(c => c !== cat))}
                    className="text-zinc-500 hover:text-zinc-300 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Business Types & MSME */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Legal Business Structures & MSME Tiers</h2>
              <p className="text-xs text-zinc-400 mt-0.5">MCA & Udyam recognized entity structures</p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-zinc-400 uppercase">Legal Entity Types:</span>
                <div className="flex flex-wrap gap-1.5">
                  {businessTypes.map(t => (
                    <span key={t} className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-[11px] text-zinc-300 font-medium">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-1 pt-2 border-t border-zinc-800/60">
                <span className="text-[11px] font-bold text-zinc-400 uppercase">MSME Classification Thresholds:</span>
                <div className="space-y-1">
                  {msmeCategories.map(tier => (
                    <div key={tier} className="p-2 bg-zinc-950 border border-zinc-800/80 rounded text-[11px] text-zinc-300">
                      {tier}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Location Masters */}
      {activeTab === 'locations' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* States */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Indian States & UTs</span>
              <span className="text-xs text-zinc-400 font-mono">({states.length})</span>
            </h2>
            <div className="max-h-80 overflow-y-auto space-y-1 pr-1 font-mono text-xs">
              {states.map(s => (
                <div key={s} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 font-sans">
                  {s}
                </div>
              ))}
            </div>
          </div>

          {/* Districts */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Districts Directory</span>
              <span className="text-xs text-zinc-400 font-mono">({districts.length})</span>
            </h2>
            <div className="max-h-80 overflow-y-auto space-y-1 pr-1 font-mono text-xs">
              {districts.map(d => (
                <div key={d} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 font-sans">
                  {d}
                </div>
              ))}
            </div>
          </div>

          {/* Cities */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Key Cities & Hubs</span>
              <span className="text-xs text-zinc-400 font-mono">({cities.length})</span>
            </h2>
            <div className="max-h-80 overflow-y-auto space-y-1 pr-1 font-mono text-xs">
              {cities.map(c => (
                <div key={c} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 font-sans">
                  {c}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Credit Packages & Plans */}
      {activeTab === 'economy' && (
        <div className="space-y-6">
          {/* Credit Packages */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Coins className="w-4 h-4 text-zinc-300" />
              Credit Purchase Packages
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {creditPacks.map(pack => (
                <div key={pack.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3 relative">
                  {pack.isPopular && (
                    <span className="absolute top-3 right-3 text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-zinc-100 text-zinc-950">
                      Popular
                    </span>
                  )}
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">{pack.name}</h3>
                    <div className="text-2xl font-bold text-zinc-100 mt-1">₹{pack.price.toLocaleString()}</div>
                    <div className="text-xs text-zinc-400 font-mono">{pack.credits.toLocaleString()} Credits</div>
                  </div>
                  <div className="space-y-1 text-[11px] text-zinc-400 pt-2 border-t border-zinc-800">
                    {pack.features.map(f => (
                      <div key={f} className="flex items-center gap-1.5">
                        <Check className="w-3 h-3 text-zinc-300 shrink-0" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Subscription Plans */}
          <div className="space-y-3 pt-4 border-t border-zinc-800">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-zinc-300" />
              Subscription Tiers & Monthly Allowances
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {subscriptionPlans.map(plan => (
                <div key={plan.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm">{plan.name} Tier</h3>
                    <div className="text-xl font-bold text-zinc-100 mt-1">₹{plan.monthlyPrice.toLocaleString()}<span className="text-xs text-zinc-400 font-normal">/mo</span></div>
                    <div className="text-xs text-zinc-400 font-mono">{plan.creditsPerMonth} Monthly Unlocks</div>
                  </div>
                  <div className="space-y-1 text-[11px] text-zinc-400 pt-2 border-t border-zinc-800">
                    <div className="text-zinc-300 font-medium">Export Limit: {plan.exportLimitMonthly.toLocaleString()} rows</div>
                    <div className="text-zinc-400 font-mono">Active Subscribers: {plan.activeSubscribers}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Validation & Import Rules */}
      {activeTab === 'rules' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6 max-w-3xl">
          <div>
            <h2 className="text-sm font-bold text-zinc-100">Automated Pipeline & Deduplication Thresholds</h2>
            <p className="text-xs text-zinc-400 mt-1">Configure parsing heuristics, fuzzy string matching, and quarantine policies.</p>
          </div>

          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div>
                <div className="text-sm font-semibold text-zinc-200">Strict Indian Phone Validation (+91)</div>
                <div className="text-xs text-zinc-400 mt-0.5">Enforces 10-digit mobile formats starting with 6, 7, 8, 9 or valid STD landline.</div>
              </div>
              <input type="checkbox" checked={strictPhoneValidation} onChange={e => setStrictPhoneValidation(e.target.checked)} className="w-4 h-4 rounded accent-zinc-200" />
            </div>

            <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div>
                <div className="text-sm font-semibold text-zinc-200">Strict Email Syntax & MX Record Check</div>
                <div className="text-xs text-zinc-400 mt-0.5">Quarantines disposable email domains and malformed company addresses.</div>
              </div>
              <input type="checkbox" checked={strictEmailMXCheck} onChange={e => setStrictEmailMXCheck(e.target.checked)} className="w-4 h-4 rounded accent-zinc-200" />
            </div>

            <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div>
                <div className="text-sm font-semibold text-zinc-200">India Pincode Postal Directory Match</div>
                <div className="text-xs text-zinc-400 mt-0.5">Cross-checks 6-digit postal codes against official postal directory.</div>
              </div>
              <input type="checkbox" checked={requirePincodeVerification} onChange={e => setRequirePincodeVerification(e.target.checked)} className="w-4 h-4 rounded accent-zinc-200" />
            </div>

            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-semibold text-zinc-200">Duplicate Name Similarity Threshold</div>
                  <div className="text-xs text-zinc-400">Levenshtein & Soundex fuzzy matching sensitivity</div>
                </div>
                <span className="font-mono text-xs font-bold text-zinc-200 bg-zinc-800 px-2 py-1 rounded">{duplicateNameThreshold}%</span>
              </div>
              <input type="range" min={70} max={99} value={duplicateNameThreshold} onChange={e => setDuplicateNameThreshold(Number(e.target.value))} className="w-full accent-zinc-200 bg-zinc-800 h-2 rounded-lg" />
            </div>

            <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div>
                <div className="text-sm font-semibold text-zinc-200">Default Draft Stage on Ingest</div>
                <div className="text-xs text-zinc-400 mt-0.5">Guarantees no records bypass human review before Discover publication.</div>
              </div>
              <input type="checkbox" checked={defaultDraftOnIngest} onChange={e => setDefaultDraftOnIngest(e.target.checked)} className="w-4 h-4 rounded accent-zinc-200" />
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Email & Notification Templates */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Mail className="w-4 h-4 text-zinc-300" />
              Automated Email Notification Templates
            </h2>
            <div className="space-y-2">
              {emailTemplates.map(tmpl => (
                <div key={tmpl.id} className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-zinc-100 text-sm">{tmpl.name}</div>
                    <div className="text-zinc-400 mt-0.5">Subject: <span className="text-zinc-300 font-mono">{tmpl.subject}</span></div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono text-[10px]">
                      Trigger: {tmpl.trigger}
                    </span>
                    <button className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold transition">
                      Edit Body
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Application Settings */}
      {activeTab === 'app_settings' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6 max-w-2xl">
          <div>
            <h2 className="text-sm font-bold text-zinc-100">Global Application Configuration</h2>
            <p className="text-xs text-zinc-400 mt-1">Manage platform branding, operational timezone, default credits, and maintenance state.</p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-medium text-zinc-400 mb-1">Platform Brand Name</label>
              <input
                type="text"
                value={platformName}
                onChange={e => setPlatformName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-zinc-400 mb-1">Server Timezone</label>
                <input
                  type="text"
                  value={timezone}
                  disabled
                  className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-400 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-zinc-400 mb-1">Base Currency</label>
                <input
                  type="text"
                  value={currency}
                  disabled
                  className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-400 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-zinc-400 mb-1">Default Free Credits on Signup</label>
                <input
                  type="number"
                  value={defaultCreditsOnSignup}
                  onChange={e => setDefaultCreditsOnSignup(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="block font-medium text-zinc-400 mb-1">Default User Role on Registration</label>
                <input
                  type="text"
                  value={defaultUserRole}
                  onChange={e => setDefaultUserRole(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg pt-3">
              <div>
                <div className="text-sm font-semibold text-zinc-200">Maintenance Mode</div>
                <div className="text-xs text-zinc-400 mt-0.5">Temporarily pauses subscriber access for database migrations.</div>
              </div>
              <input
                type="checkbox"
                checked={maintenanceMode}
                onChange={e => setMaintenanceMode(e.target.checked)}
                className="w-4 h-4 rounded accent-zinc-200"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
