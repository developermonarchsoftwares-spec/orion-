import { 
  Building2, 
  FileText, 
  Contact2, 
  Sparkles, 
  CheckCircle2,
  Database
} from "lucide-react";

export function WhatOwnusGivesYouSection() {
  const cards = [
    {
      title: "Business Information",
      tagline: "Core profile & market focus",
      icon: Building2,
      badge: "Market Identity",
      items: [
        "Company Name",
        "Industry",
        "Business Category",
        "Business Description",
        "Products & Services",
      ],
    },
    {
      title: "Company Information",
      tagline: "Corporate structure & details",
      icon: FileText,
      badge: "Company Data",
      items: [
        "Registration Date",
        "Location",
        "Business Type",
        "Company Status",
        "Website",
      ],
    },
    {
      title: "Contact Information",
      tagline: "Direct channels to key decision-makers",
      icon: Contact2,
      badge: "Verified Outreach",
      items: [
        "Business Email",
        "Business Phone",
        "Website Contact",
        "Public Business Profiles",
      ],
    },
    {
      title: "Business Intelligence",
      tagline: "Real-time qualification metrics",
      icon: Sparkles,
      badge: "Signal Scoring",
      items: [
        "Registration Age",
        "Data Freshness",
        "Verification Status",
        "Confidence Level",
      ],
    },
  ];

  return (
    <section className="py-20 sm:py-28 bg-white dark:bg-black">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 mb-4">
            <Database className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
            Enriched Intelligence
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
            More Than a Company List.
          </h2>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            Ownus transforms basic business records into useful company intelligence.
          </p>
        </div>

        {/* 4 Data Cards Grid */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="flex flex-col rounded-2xl bg-zinc-50/60 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800 p-6 hover:shadow-lg hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-200 relative group"
              >
                {/* Header of Card */}
                <div className="flex items-center justify-between mb-5">
                  <div className="w-12 h-12 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shadow-2xs group-hover:scale-105 transition-transform">
                    <Icon className="w-6 h-6 text-zinc-900 dark:text-zinc-100" />
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                    {card.badge}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                  {card.title}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 mb-6">
                  {card.tagline}
                </p>

                {/* Items List */}
                <div className="mt-auto space-y-3 pt-4 border-t border-zinc-200/80 dark:border-zinc-800">
                  {card.items.map((item) => (
                    <div key={item} className="flex items-center gap-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                      <CheckCircle2 className="w-4 h-4 text-zinc-900 dark:text-zinc-100 shrink-0" />
                      <span className="font-medium">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
