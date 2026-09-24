import { Search, Sparkles, ShieldCheck, Send } from "lucide-react";

export function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      name: "Discover",
      description: "Search businesses using location, industry and registration-age filters.",
      icon: Search,
    },
    {
      step: "02",
      name: "Enrich",
      description: "Get useful business information beyond the basic company record.",
      icon: Sparkles,
    },
    {
      step: "03",
      name: "Verify",
      description: "Validate and verify company profiles to ensure high data quality and freshness.",
      icon: ShieldCheck,
    },
    {
      step: "04",
      name: "Connect",
      description: "Use relevant business information to identify and pursue opportunities.",
      icon: Send,
    },
  ];

  return (
    <section id="how-it-works" className="py-20 sm:py-28 bg-white dark:bg-black overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 mb-4">
            Simple 4-Step Process
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-5xl">
            How Ownus Works
          </h2>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            From early discovery to qualified outreach in four seamless steps.
          </p>
        </div>

        <div className="relative max-w-6xl mx-auto">
          {/* Connecting line for desktop */}
          <div className="absolute top-10 left-12 right-12 h-0.5 border-t-2 border-dashed border-zinc-200 dark:border-zinc-800 -z-0 hidden lg:block" />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative z-10">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.step} className="flex flex-col items-center text-center group">
                  {/* Step Icon Badge */}
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-white shadow-md mb-6 group-hover:scale-105 transition-transform">
                    <div className="absolute -top-2.5 -right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black text-xs font-bold shadow-xs">
                      {step.step}
                    </div>
                    <Icon className="h-8 w-8 text-zinc-900 dark:text-zinc-100" />
                  </div>

                  <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">
                    {step.step}. {step.name}
                  </h3>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xs leading-relaxed">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
