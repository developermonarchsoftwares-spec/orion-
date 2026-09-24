import Link from "next/link";
import { Clock, Flame, Zap, Compass, Building, ArrowRight } from "lucide-react";

export function FreshDiscoverySection() {
  const ageTiers = [
    {
      range: "0-7 Days",
      label: "Just registered",
      badge: "Highest Priority",
      icon: Flame,
      highlight: true,
      description: "Brand-new companies registered in the last 7 days. Be the very first partner to reach out before competitors even know they exist.",
    },
    {
      range: "8-30 Days",
      label: "Recently registered",
      badge: "High Intent",
      icon: Zap,
      highlight: false,
      description: "Setting up operations, procuring initial vendors, bank accounts, software licenses, and compliance services.",
    },
    {
      range: "31-90 Days",
      label: "Early-stage businesses",
      badge: "Active Growth",
      icon: Compass,
      highlight: false,
      description: "Actively hiring initial teams, launching customer-facing websites, and investing in marketing & technology stacks.",
    },
    {
      range: "90-365 Days",
      label: "Established new businesses",
      badge: "Expanding",
      icon: Building,
      highlight: false,
      description: "Past the initial setup phase with steady commercial operations, ready for scaling solutions and enterprise contracts.",
    },
  ];

  return (
    <section className="py-20 sm:py-28 bg-zinc-50 dark:bg-zinc-950 border-y border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 mb-4">
            <Clock className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-100" />
            Time-to-Market Advantage
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-5xl">
            Find New Businesses Before They Become Saturated Leads.
          </h2>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            Discover businesses based on how recently they entered the market.
          </p>
        </div>

        {/* Registration Age Grid */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {ageTiers.map((tier) => {
            const Icon = tier.icon;
            return (
              <div
                key={tier.range}
                className={`relative flex flex-col rounded-2xl p-6 transition-all duration-200 border ${
                  tier.highlight
                    ? "bg-white dark:bg-zinc-900 border-zinc-900 dark:border-white shadow-xl ring-2 ring-zinc-900/10 dark:ring-white/10"
                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-2xs hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
              >
                {/* Badge */}
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    tier.highlight
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    tier.highlight
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border border-zinc-700 dark:border-zinc-300"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                  }`}>
                    {tier.badge}
                  </span>
                </div>

                <div className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
                  {tier.range}
                </div>
                <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mt-1 mb-3">
                  {tier.label}
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mt-auto pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  {tier.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* CTA Button */}
        <div className="mt-12 text-center">
          <Link
            href="/discover"
            className="inline-flex items-center gap-2 rounded-xl bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-8 py-4 text-base font-semibold shadow-md transition-colors"
          >
            <span>Discover Fresh Businesses</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
