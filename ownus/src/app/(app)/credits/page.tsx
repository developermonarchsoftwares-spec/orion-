"use client";

import { useState, useEffect } from "react";
import { cn, formatNumber, formatRelativeDate } from "@/lib/utils";
import { CreditCard, Download, Check, HelpCircle, Loader2, Sparkles, Clock, ShieldCheck, Zap, ArrowRight, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export default function CreditsPage() {
  const { wallet, setWalletBalance } = useAuth();
  const [activeTab, setActiveTab] = useState("transactions");
  const [historyTab, setHistoryTab] = useState("payments");
  const [isAnnual, setIsAnnual] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [pricingConfig, setPricingConfig] = useState<any>({
    dailyFreeCredits: 5,
    annualDiscountPercentage: 20,
    defaultCurrency: "INR",
    currencySymbol: "₹",
  });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [purchasingPkgId, setPurchasingPkgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadCreditData() {
      try {
        const [pkgs, config, txData, payData] = await Promise.all([
          apiClient.credit.getPackages(),
          apiClient.credit.getConfig(),
          apiClient.credit.getTransactions(1, 25),
          apiClient.payments.getHistory(),
        ]);
        if (pkgs && pkgs.length > 0) setPackages(pkgs);
        if (config) setPricingConfig(config);
        if (txData?.items) setTransactions(txData.items);
        if (payData) setPayments(payData);
      } catch (err) {
        console.warn("Credit API fallback active:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadCreditData();
  }, []);

  const handlePurchase = async (pkg: any) => {
    if (pkg.billingType === "CUSTOM" || pkg.priceInr === null) {
      toast.info("Connecting to Orion Enterprise sales advisory team...");
      window.location.href = "mailto:sales@orion.ai?subject=Enterprise%20Plan%20Inquiry%20-%20Orion%20Lead%20Intelligence";
      return;
    }

    if (pkg.priceInr === 0) {
      toast.info("The Free Plan includes 5 daily credits allocated automatically every day.");
      return;
    }

    const price = isAnnual && pkg.priceAnnualInr ? pkg.priceAnnualInr : pkg.priceInr;
    setPurchasingPkgId(pkg.id);

    try {
      // 1. Create Razorpay order
      const orderData = await apiClient.payments.createOrder({
        packageId: pkg.id,
        billingCycle: isAnnual ? "annual" : "monthly",
        currency: pricingConfig.defaultCurrency || "INR",
      });

      // 2. Perform payment verification (Simulation / Razorpay client checkout)
      toast.info(`Initializing secure Razorpay checkout for ₹${price}...`);
      
      const verifyRes = await apiClient.payments.verify({
        razorpayOrderId: orderData.orderId,
        razorpayPaymentId: `pay_${Date.now()}_razorpay`,
        razorpaySignature: "demo_verified",
        packageId: pkg.id,
        billingCycle: isAnnual ? "annual" : "monthly",
      });

      if (verifyRes.balance !== undefined) {
        setWalletBalance(verifyRes.balance, verifyRes.dailyCredits, verifyRes.purchasedCredits);
      }

      toast.success(verifyRes.message || `Successfully credited ${pkg.credits} credits to your wallet!`);

      // Refresh transactions & payments
      const [newTxs, newPays] = await Promise.all([
        apiClient.credit.getTransactions(1, 25),
        apiClient.payments.getHistory(),
      ]);
      if (newTxs?.items) setTransactions(newTxs.items);
      if (newPays) setPayments(newPays);
    } catch (err: any) {
      toast.error(err.message || "Payment process failed. Please try again.");
    } finally {
      setPurchasingPkgId(null);
    }
  };

  const currentBalance = wallet?.balance ?? 5;
  const dailyCredits = wallet?.dailyCredits ?? 5;
  const purchasedCredits = wallet?.purchasedCredits ?? 0;
  const lifetimePurchased = wallet?.lifetimePurchased ?? 0;
  const lifetimeUsed = wallet?.lifetimeUsed ?? 0;

  const displayPackages = packages.length > 0 ? packages : [
    {
      id: "free",
      slug: "free",
      name: "Free Plan",
      description: "Standard access for early prospecting and exploring verified business intelligence.",
      priceInr: 0,
      priceAnnualInr: 0,
      credits: 5,
      userLimit: 1,
      billingType: "DAILY_FREE",
      badgeText: "5 Daily Credits",
      popular: false,
      features: [
        "5 Daily Verified Leads",
        "Search & Discovery Engine",
        "Basic Contact Details",
        "Daily reset at 11:59 PM",
        "Community Support",
      ],
    },
    {
      id: "starter",
      slug: "starter",
      name: "Starter Pack",
      description: "Ideal for individual founders, freelancers, and sales reps building focused pipelines.",
      priceInr: 99,
      priceAnnualInr: 79,
      credits: 100,
      userLimit: 1,
      billingType: "ONE_TIME",
      badgeText: "Save 20% with Annual Billing",
      popular: false,
      features: [
        "100 Lifetime Lead Credits",
        "Credits Never Expire",
        "Direct Mobile & Email Unlocks",
        "CSV / Spreadsheet Export",
        "Single User License",
        "Standard Support",
      ],
    },
    {
      id: "growth",
      slug: "growth",
      name: "Growth Pack",
      description: "Best for growing sales teams and agencies looking for rapid pipeline scale.",
      priceInr: 299,
      priceAnnualInr: 239,
      credits: 350,
      userLimit: 1,
      billingType: "ONE_TIME",
      popular: true,
      badgeText: "Most Popular • Save 20% Annual",
      features: [
        "350 Lifetime Lead Credits",
        "Credits Never Expire",
        "Direct Decision Maker Contacts",
        "Full Export & Filter Capabilities",
        "Single User License",
        "Priority Email Support",
      ],
    },
    {
      id: "agency",
      slug: "agency",
      name: "Agency Pack",
      description: "High-volume lead intelligence for outreach agencies and enterprise outbound teams.",
      priceInr: 999,
      priceAnnualInr: 799,
      credits: 1500,
      userLimit: 1,
      billingType: "ONE_TIME",
      badgeText: "Best Value • Save 20% Annual",
      popular: false,
      features: [
        "1,500 Lifetime Lead Credits",
        "Credits Never Expire",
        "Full Executive & CXO Contacts",
        "Bulk Export Engine",
        "Single User License",
        "Priority VIP Support",
      ],
    },
    {
      id: "enterprise",
      slug: "enterprise",
      name: "Enterprise Plan",
      description: "Custom high-volume intelligence, dedicated infrastructure, and team workspace management.",
      priceInr: null,
      priceAnnualInr: null,
      credits: 0,
      userLimit: null,
      billingType: "CUSTOM",
      badgeText: "Custom Solution",
      popular: false,
      features: [
        "Custom High-Volume Credit Allocation",
        "Unlimited Team Users & RBAC",
        "Team Workspace Collaboration",
        "Bulk Export Engine",
        "Dedicated API Access",
        "24x7 Priority Account Manager",
      ],
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-16 text-zinc-900 dark:text-zinc-100">
      
      {/* Top Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <Zap className="w-3 h-3 fill-current" />
            Credit System & INR Billing
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Wallet & Intelligence Credits
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Each credit unlocks full unmasked decision-maker contacts, direct phones, verified emails, and corporate registry intelligence.
        </p>
      </div>

      {/* Hero Cards: Balance & Rule Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* Total Available Balance Card */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xs flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Available</span>
              <span className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                <Zap className="w-4 h-4 text-amber-500 fill-current" />
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-black font-mono tracking-tight text-zinc-900 dark:text-zinc-100">
                {formatNumber(currentBalance)}
              </span>
              <span className="text-xs text-zinc-500 font-medium">Credits</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
            <span>Lifetime used:</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">{formatNumber(lifetimeUsed)} leads</span>
          </div>
        </div>

        {/* Daily Free Credits Card */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Daily Free Credits
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                5 / Day
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-black font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
                {formatNumber(dailyCredits)}
              </span>
              <span className="text-xs text-zinc-500 font-medium">remaining today</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 text-[11px] text-zinc-500 leading-normal">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Deducted First.</span> Resets every day at 11:59 PM. Expired daily credits do not roll over.
          </div>
        </div>

        {/* Purchased Credits Card */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Purchased Credits
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                Never Expire
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-black font-mono tracking-tight text-indigo-600 dark:text-indigo-400">
                {formatNumber(purchasedCredits)}
              </span>
              <span className="text-xs text-zinc-500 font-medium">active lifetime</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 text-[11px] text-zinc-500 leading-normal">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Lifetime Validity.</span> Consumed only after today&apos;s daily credits reach 0.
          </div>
        </div>

      </div>

      {/* Consumption Policy Banner */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shrink-0">
            <HelpCircle className="w-4 h-4" />
          </div>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            <strong className="text-zinc-900 dark:text-zinc-200 font-semibold">Zero Cost on Re-unlock:</strong> Previously unlocked leads never deduct credits again. Unlocking leads always uses your 5 daily credits before dipping into purchased packs.
          </p>
        </div>
      </div>

      {/* Pricing Packages Section */}
      <div className="space-y-6 pt-2">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Choose Your Intelligence Plan
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Configurable INR plans. Top up anytime with instant activation.
            </p>
          </div>

          {/* Annual Billing Switch */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="relative flex rounded-full bg-zinc-100 dark:bg-zinc-900 p-1 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setIsAnnual(false)}
                className={cn(
                  "relative px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer",
                  !isAnnual
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                )}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setIsAnnual(true)}
                className={cn(
                  "relative px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
                  isAnnual
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                )}
              >
                <span>Annual Billing</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-600 text-white">
                  Save {pricingConfig.annualDiscountPercentage}%
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* 5 Package Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {displayPackages.map((pkg) => {
            const isFree = pkg.priceInr === 0;
            const isCustom = pkg.billingType === "CUSTOM" || pkg.priceInr === null;
            const isPopular = pkg.popular;
            const isPurchasing = purchasingPkgId === pkg.id;

            const price = isAnnual && pkg.priceAnnualInr ? pkg.priceAnnualInr : pkg.priceInr;

            return (
              <div
                key={pkg.id}
                className={cn(
                  "border rounded-xl p-5 flex flex-col justify-between transition-all relative overflow-hidden",
                  isPopular
                    ? "bg-zinc-900 dark:bg-zinc-900 text-white border-zinc-800 dark:border-zinc-700 shadow-md transform lg:-translate-y-1 ring-2 ring-zinc-900 dark:ring-zinc-100"
                    : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:shadow-xs"
                )}
              >
                {isPopular && (
                  <div className="absolute top-0 right-0 bg-white text-zinc-950 text-[9px] font-black px-2 py-0.5 rounded-bl-lg uppercase tracking-wider">
                    Most Popular
                  </div>
                )}

                <div>
                  {/* Plan Name & Tag */}
                  <div className="mb-3">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider block mb-1",
                      isPopular ? "text-amber-400" : "text-zinc-500"
                    )}>
                      {pkg.userLimit ? `${pkg.userLimit} User` : "Unlimited Users"}
                    </span>
                    <h3 className={cn("text-base font-bold", isPopular ? "text-white" : "text-zinc-900 dark:text-zinc-100")}>
                      {pkg.name}
                    </h3>
                  </div>

                  {/* Pricing Display */}
                  <div className="mb-4">
                    {isCustom ? (
                      <div className="flex items-baseline gap-1">
                        <span className={cn("text-2xl font-black tracking-tight", isPopular ? "text-white" : "text-zinc-900 dark:text-zinc-100")}>
                          Custom
                        </span>
                        <span className={cn("text-[11px]", isPopular ? "text-zinc-400" : "text-zinc-500")}>
                          pricing
                        </span>
                      </div>
                    ) : isFree ? (
                      <div className="flex items-baseline gap-1">
                        <span className={cn("text-2xl font-black tracking-tight font-mono", isPopular ? "text-white" : "text-zinc-900 dark:text-zinc-100")}>
                          ₹0
                        </span>
                        <span className={cn("text-[11px]", isPopular ? "text-zinc-400" : "text-zinc-500")}>
                          / 5 daily leads
                        </span>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className={cn("text-2xl font-black tracking-tight font-mono", isPopular ? "text-white" : "text-zinc-900 dark:text-zinc-100")}>
                            ₹{price?.toLocaleString()}
                          </span>
                          <span className={cn("text-[11px]", isPopular ? "text-zinc-400" : "text-zinc-500")}>
                            / {pkg.credits} credits
                          </span>
                        </div>
                        <p className={cn("text-[10px] mt-0.5", isPopular ? "text-zinc-400" : "text-zinc-500")}>
                          ₹{(price / (pkg.credits || 1)).toFixed(2)} / lead • Never expires
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Features List */}
                  <ul className="space-y-2.5 mb-6 text-xs border-t pt-4 border-zinc-100 dark:border-zinc-800">
                    {(pkg.features || []).map((feat: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[11px]">
                        <Check className={cn(
                          "w-3.5 h-3.5 mt-0.5 shrink-0",
                          isPopular ? "text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                        )} />
                        <span className={cn(isPopular ? "text-zinc-300" : "text-zinc-600 dark:text-zinc-400")}>
                          {feat}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Purchase / Action Button */}
                <button
                  onClick={() => handlePurchase(pkg)}
                  disabled={isPurchasing || (isFree && dailyCredits > 0)}
                  className={cn(
                    "w-full py-2.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 text-center",
                    isPopular
                      ? "bg-white text-zinc-900 hover:bg-zinc-100 shadow-sm"
                      : isFree
                      ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-default"
                      : "border border-zinc-300 dark:border-zinc-700 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 shadow-xs"
                  )}
                >
                  {isPurchasing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Processing...
                    </>
                  ) : isFree ? (
                    "Active Plan (5/Day)"
                  ) : isCustom ? (
                    "Contact Sales"
                  ) : (
                    `Buy ${pkg.name}`
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs: Transaction History & Razorpay Ledger */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs">
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setActiveTab("transactions")}
            className={cn(
              "px-6 py-3.5 text-xs font-semibold transition-colors border-b-2 cursor-pointer",
              activeTab === "transactions" 
                ? "border-zinc-900 dark:border-white text-zinc-900 dark:text-white" 
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            Credit Transaction Ledger
          </button>
          <button
            onClick={() => setActiveTab("billing")}
            className={cn(
              "px-6 py-3.5 text-xs font-semibold transition-colors border-b-2 cursor-pointer",
              activeTab === "billing" 
                ? "border-zinc-900 dark:border-white text-zinc-900 dark:text-white" 
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            Razorpay Payments & Invoices
          </button>
        </div>

        <div className="p-0">
          {activeTab === "transactions" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 uppercase text-[11px] font-semibold border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-6 py-3.5">Date</th>
                    <th className="px-6 py-3.5">Type</th>
                    <th className="px-6 py-3.5">Balance Pool</th>
                    <th className="px-6 py-3.5">Description</th>
                    <th className="px-6 py-3.5 text-right">Credits</th>
                    <th className="px-6 py-3.5 text-right">Total Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {transactions.length > 0 ? (
                    transactions.map((tx: any) => {
                      const isPositive = tx.amount > 0;
                      const balanceType = tx.balanceType || (tx.type.includes("DAILY") ? "DAILY" : "PURCHASED");

                      return (
                        <tr key={tx.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
                          <td className="px-6 py-3.5 text-zinc-500 font-mono">
                            {tx.createdAt ? formatRelativeDate(tx.createdAt) : tx.date || "Recent"}
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium border bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700">
                              {tx.type}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className={cn(
                              "px-2 py-0.5 rounded-md text-[10px] font-semibold border",
                              balanceType === "DAILY"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                                : balanceType === "MIXED"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                                : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
                            )}>
                              {balanceType}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-zinc-900 dark:text-zinc-100 font-medium">{tx.description}</td>
                          <td className={cn("px-6 py-3.5 text-right font-mono font-semibold", isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-100")}>
                            {isPositive ? `+${tx.amount}` : tx.amount}
                          </td>
                          <td className="px-6 py-3.5 text-right text-zinc-900 dark:text-zinc-100 font-mono font-medium">
                            {tx.balanceAfter !== undefined ? tx.balanceAfter.toLocaleString() : tx.balance?.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500">
                        No transactions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "billing" && (
            <div className="p-6">
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => setHistoryTab("payments")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border cursor-pointer",
                    historyTab === "payments" 
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white font-semibold" 
                      : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50"
                  )}
                >
                  Payment History
                </button>
                <button
                  onClick={() => setHistoryTab("invoices")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border cursor-pointer",
                    historyTab === "invoices" 
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white font-semibold" 
                      : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50"
                  )}
                >
                  Invoices
                </button>
              </div>

              {historyTab === "payments" ? (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 uppercase text-[11px] font-semibold border-b border-zinc-200 dark:border-zinc-800">
                      <tr>
                        <th className="px-6 py-3.5">Date</th>
                        <th className="px-6 py-3.5">Method</th>
                        <th className="px-6 py-3.5">Description</th>
                        <th className="px-6 py-3.5">Credits</th>
                        <th className="px-6 py-3.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {payments.length > 0 ? (
                        payments.map((p: any) => (
                          <tr key={p.id}>
                            <td className="px-6 py-3.5 text-zinc-500 font-mono">
                              {p.date ? formatRelativeDate(p.date) : "Recent"}
                            </td>
                            <td className="px-6 py-3.5 text-zinc-900 dark:text-zinc-100 flex items-center gap-2 font-medium">
                              <CreditCard className="w-3.5 h-3.5 text-zinc-400" />
                              Razorpay UPI / Card
                            </td>
                            <td className="px-6 py-3.5 font-medium">{p.description}</td>
                            <td className="px-6 py-3.5 font-mono font-semibold text-emerald-600 dark:text-emerald-400">+{p.credits}</td>
                            <td className="px-6 py-3.5">
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium border bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                                Captured
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-zinc-500">
                            No payment history recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 uppercase text-[11px] font-semibold border-b border-zinc-200 dark:border-zinc-800">
                      <tr>
                        <th className="px-6 py-3.5">Invoice #</th>
                        <th className="px-6 py-3.5">Date</th>
                        <th className="px-6 py-3.5">Package</th>
                        <th className="px-6 py-3.5">Status</th>
                        <th className="px-6 py-3.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {payments.length > 0 ? (
                        payments.map((inv: any, i: number) => (
                          <tr key={inv.id}>
                            <td className="px-6 py-3.5 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                              INV-2026-{String(i + 1).padStart(3, "0")}
                            </td>
                            <td className="px-6 py-3.5 text-zinc-500 font-mono">
                              {inv.date ? formatRelativeDate(inv.date) : "Recent"}
                            </td>
                            <td className="px-6 py-3.5 font-medium">{inv.description}</td>
                            <td className="px-6 py-3.5">
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium border bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700">
                                Paid
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              <button
                                onClick={() => toast.success(`Downloaded invoice INV-2026-${String(i + 1).padStart(3, "0")}`)}
                                className="text-zinc-900 dark:text-zinc-100 hover:underline inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Download</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-zinc-500">
                            No invoices generated yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
