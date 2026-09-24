import { Target, Palette, Users2, Briefcase, Check } from "lucide-react";

export function UseCasesSection() {
  const useCases = [
    {
      title: "Sales Teams",
      description: "Find new companies to prospect.",
      icon: Target,
      tag: "Outbound Sales",
      features: [
        "First-mover advantage on brand new registrations",
        "Direct verified contact details for decision makers",
        "Export prospects directly into your sales pipeline",
      ],
    },
    {
      title: "Digital Agencies",
      description: "Discover businesses that may need websites, marketing or technology services.",
      icon: Palette,
      tag: "Web & Marketing",
      features: [
        "Filter newly incorporated businesses without websites",
        "Pitch branding, development & SEO services at launch",
        "High response rates from new founders setting up shop",
      ],
    },
    {
      title: "Recruitment Teams",
      description: "Find growing and newly established companies.",
      icon: Users2,
      tag: "Talent Acquisition",
      features: [
        "Identify newly funded or expanding ventures early",
        "Target companies building out initial core teams",
        "Connect with founders during initial hiring phases",
      ],
    },
    {
      title: "B2B Businesses",
      description: "Discover companies matching your target industry and location.",
      icon: Briefcase,
      tag: "Enterprise & Vendors",
      features: [
        "Precise state, district, and industry segmentation",
        "Suppliers, logistics, and office infrastructure matching",
        "Continually refreshed database of verified companies",
      ],
    },
  ];

  return (
    <section className="py-20 sm:py-28 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-200/70 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 mb-4">
            Built for Businesses That Need Leads
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
            Find Your Next Customers.
          </h2>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            Ownus helps sales teams, agencies, recruiters and B2B businesses discover companies matching their target market.
          </p>
        </div>

        {/* Use Cases Grid */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {useCases.map((useCase) => {
            const Icon = useCase.icon;
            return (
              <div
                key={useCase.title}
                className="flex flex-col rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 shadow-2xs hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-zinc-900 dark:text-zinc-100" />
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                    {useCase.tag}
                  </span>
                </div>

                <h3 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
                  {useCase.title}
                </h3>
                <p className="text-base text-zinc-600 dark:text-zinc-400 mb-6">
                  {useCase.description}
                </p>

                <div className="mt-auto space-y-2.5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                  {useCase.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300">
                      <div className="w-4 h-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5 text-zinc-900 dark:text-zinc-100" />
                      </div>
                      <span>{feature}</span>
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
