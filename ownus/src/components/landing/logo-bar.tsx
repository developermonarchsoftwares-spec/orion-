import { MapPin, Activity, ShieldCheck, Zap, Database } from "lucide-react";

export function LogoBar() {
  const regionalHubs = [
    { city: "Bengaluru", state: "KA", count: "+142 this week", sector: "Tech & SaaS" },
    { city: "Mumbai", state: "MH", count: "+188 this week", sector: "BFSI & Trade" },
    { city: "Delhi NCR", state: "DL/HR", count: "+215 this week", sector: "Logistics & Commerce" },
    { city: "Chennai", state: "TN", count: "+96 this week", sector: "Manufacturing & Auto" },
    { city: "Hyderabad", state: "TS", count: "+114 this week", sector: "Pharma & Cloud" },
    { city: "Pune", state: "MH", count: "+78 this week", sector: "Engineering & IT" },
    { city: "Ahmedabad", state: "GJ", count: "+92 this week", sector: "Chemical & Energy" },
    { city: "Coimbatore", state: "TN", count: "+54 this week", sector: "Precision & Pumps" },
  ];

  const platformStats = [
    { value: "15,000+", label: "New Incorporations Monthly", icon: Activity },
    { value: "28 States", label: "Pan-India Coverage", icon: MapPin },
    { value: "< 24 Hours", label: "Ingestion to Search Window", icon: Zap },
    { value: "100%", label: "Verified Business Records", icon: ShieldCheck },
  ];

  return (
    <div className="border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950 py-10 sm:py-12 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Ticker Header */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="flex h-2 w-2 rounded-full bg-zinc-900 dark:bg-white animate-pulse" />
          <p className="text-xs font-semibold tracking-wider uppercase text-zinc-500 dark:text-zinc-400">
            Real-Time Ingestion • Tracking New Businesses Across India
          </p>
        </div>

        {/* Live Regional Hubs Marquee */}
        <div className="relative w-full overflow-hidden mask-fade-edges">
          {/* Subtle gradient edge masks */}
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-12 sm:w-24 bg-gradient-to-r from-zinc-50 dark:from-zinc-950 to-transparent z-10" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 sm:w-24 bg-gradient-to-l from-zinc-50 dark:from-zinc-950 to-transparent z-10" />

          <div className="animate-marquee gap-3 py-1">
            {[...regionalHubs, ...regionalHubs].map((hub, index) => (
              <div
                key={index}
                className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs shrink-0 select-none hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  {hub.city}
                </span>
                <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                  ({hub.state})
                </span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                  {hub.count}
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  • {hub.sector}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Metrics Telemetry Strip */}
        <div className="mt-10 pt-8 border-t border-zinc-200/80 dark:border-zinc-800/80 grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {platformStats.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div
                key={i}
                className="flex items-center gap-3.5 p-3 sm:p-4 rounded-xl bg-white dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800/70 shadow-2xs"
              >
                <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-zinc-800 dark:text-zinc-200" />
                </div>
                <div>
                  <div className="text-base sm:text-lg font-black tracking-tight text-zinc-900 dark:text-white leading-none">
                    {stat.value}
                  </div>
                  <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mt-1 leading-tight">
                    {stat.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
