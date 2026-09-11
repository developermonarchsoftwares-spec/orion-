import { Search, BarChart3, Target } from "lucide-react";

export function HowItWorksSection() {
  const steps = [
    {
      id: 1,
      name: "Discover",
      description: "Browse thousands of newly registered businesses. Filter by industry, location, and opportunity score.",
      icon: Search,
    },
    {
      id: 2,
      name: "Analyze",
      description: "Review detailed business profiles, digital presence analysis, and AI-generated opportunity scores.",
      icon: BarChart3,
    },
    {
      id: 3,
      name: "Convert",
      description: "Unlock contact information, export leads, and start converting opportunities into clients.",
      icon: Target,
    },
  ];

  return (
    <section id="how-it-works" className="py-20 sm:py-24 bg-white dark:bg-black overflow-hidden">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            Get started in minutes
          </h2>
        </div>

        <div className="relative max-w-5xl mx-auto">
          {/* Connecting line for desktop */}
          <div className="absolute top-1/2 left-0 w-full h-0.5 border-t-2 border-dashed border-gray-200 dark:border-neutral-800 -z-10 hidden md:block -mt-12"></div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {steps.map((step) => (
              <div key={step.name} className="relative flex flex-col items-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white dark:bg-neutral-900 border-4 border-black dark:border-white shadow-sm mb-6 z-10 relative">
                  <div className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black dark:bg-white text-xs font-bold text-white dark:text-black">
                    {step.id}
                  </div>
                  <step.icon className="h-8 w-8 text-black dark:text-white" aria-hidden="true" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">{step.name}</h3>
                <p className="text-base text-gray-600 dark:text-gray-400 max-w-xs">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
