import { 
  Search, 
  Brain, 
  TrendingUp, 
  Zap, 
  BookmarkCheck, 
  Download 
} from "lucide-react";

export function FeaturesSection() {
  const features = [
    {
      name: "AI-Powered Discovery",
      description: "Automatically discover newly registered businesses across all 50 states with our intelligent crawling engine.",
      icon: Search,
    },
    {
      name: "Lead Intelligence",
      description: "Get deep insights into each business including digital presence, technology stack, and growth potential.",
      icon: Brain,
    },
    {
      name: "Opportunity Scoring",
      description: "Our AI analyzes multiple signals to rank businesses by their likelihood to need your services.",
      icon: TrendingUp,
    },
    {
      name: "Credit-Based Unlocking",
      description: "Only pay for the leads you want. Unlock contact details and full business intelligence with credits.",
      icon: Zap,
    },
    {
      name: "Smart Saved Searches",
      description: "Save your search criteria and get notified when new matching businesses are discovered.",
      icon: BookmarkCheck,
    },
    {
      name: "Export & Integrate",
      description: "Export your leads to CSV or integrate with your existing CRM through our API.",
      icon: Download,
    },
  ];

  return (
    <section id="features" className="py-20 sm:py-24 bg-gray-50 dark:bg-black">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            Everything you need to discover and convert leads
          </h2>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
            Powerful tools to find, analyze, and prioritize new business opportunities
          </p>
        </div>
        
        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.name}
              className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 p-8 shadow-sm hover:shadow-md transition-all duration-200"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black dark:bg-white mb-6">
                <feature.icon className="h-6 w-6 text-white dark:text-black" aria-hidden="true" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                {feature.name}
              </h3>
              <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
