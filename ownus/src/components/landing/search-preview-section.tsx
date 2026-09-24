import Link from "next/link";
import { 
  Building2, 
  MapPin, 
  Navigation, 
  Clock, 
  Briefcase, 
  ShieldCheck, 
  Globe, 
  PhoneCall, 
  Search,
  ArrowRight,
  CheckCircle2,
  Calendar
} from "lucide-react";

export function SearchPreviewSection() {
  const mandatoryFilters = [
    { name: "Industry", icon: Building2, example: "Manufacturing, IT, Healthcare" },
    { name: "State", icon: MapPin, example: "Tamil Nadu, Maharashtra, Karnataka" },
    { name: "City / District", icon: Navigation, example: "Chennai, Coimbatore, Pune" },
    { name: "Registration Age", icon: Clock, example: "0-7d, 8-30d, 31-90d" },
    { name: "Business Type", icon: Briefcase, example: "Pvt Ltd, LLP, Sole Prop" },
    { name: "Company Status", icon: ShieldCheck, example: "Active, Registered" },
    { name: "Website Availability", icon: Globe, example: "Has Website, Verified Domain" },
    { name: "Contact Availability", icon: PhoneCall, example: "Phone, Email, LinkedIn" },
  ];

  const sampleResults = [
    {
      name: "Coimbatore Precision Tooling Pvt Ltd",
      industry: "Manufacturing",
      location: "Coimbatore, Tamil Nadu",
      registered: "12 days ago",
      status: "Active",
      type: "Private Limited",
      hasContact: true,
      hasWebsite: true,
    },
    {
      name: "Coromandel Industrial Dynamics LLP",
      industry: "Manufacturing",
      location: "Chennai, Tamil Nadu",
      registered: "19 days ago",
      status: "Active",
      type: "LLP",
      hasContact: true,
      hasWebsite: true,
    },
    {
      name: "Kovai Advanced Forgings & Alloys",
      industry: "Manufacturing",
      location: "Salem, Tamil Nadu",
      registered: "24 days ago",
      status: "Active",
      type: "Private Limited",
      hasContact: true,
      hasWebsite: false,
    },
  ];

  return (
    <section className="py-20 sm:py-28 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-200/70 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 mb-4">
            <Search className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
            Search & Discovery Engine
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
            Find the businesses that matter to you.
          </h2>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            Build targeted searches using powerful business filters.
          </p>
        </div>

        {/* Mandatory Filters Grid */}
        <div className="mt-14">
          <div className="text-center mb-6">
            <span className="text-xs font-semibold tracking-wider uppercase text-zinc-500 dark:text-zinc-400">
              8 Powerful Core Filters
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {mandatoryFilters.map((filter) => {
              const Icon = filter.icon;
              return (
                <div
                  key={filter.name}
                  className="flex flex-col items-center justify-center p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs hover:border-zinc-400 dark:hover:border-zinc-700 transition-colors text-center group"
                >
                  <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
                    <Icon className="w-4 h-4 text-zinc-800 dark:text-zinc-200" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                    {filter.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Example Search Showcase */}
        <div className="mt-12 max-w-4xl mx-auto">
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
            {/* Search Header Bar */}
            <div className="p-4 sm:p-6 bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-zinc-900 dark:bg-white"></span>
                Example Search
              </div>
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                <div className="flex items-center gap-3 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 flex-1 shadow-2xs">
                  <Search className="w-5 h-5 text-zinc-400 shrink-0" />
                  <span className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    Manufacturing companies registered in Tamil Nadu within the last 30 days
                  </span>
                </div>
                <Link
                  href="/discover"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-black text-white dark:bg-white dark:text-black font-semibold text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-sm shrink-0"
                >
                  <span>Search Businesses</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Active Filter Chips */}
              <div className="flex flex-wrap gap-2 mt-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
                  <Building2 className="w-3 h-3 text-zinc-500" />
                  Industry: Manufacturing
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
                  <MapPin className="w-3 h-3 text-zinc-500" />
                  State: Tamil Nadu
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border border-zinc-700 dark:border-zinc-300">
                  <Clock className="w-3 h-3" />
                  Age: ≤ 30 Days
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
                  <CheckCircle2 className="w-3 h-3 text-zinc-500" />
                  Status: Active
                </span>
              </div>
            </div>

            {/* Results Preview List */}
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {sampleResults.map((company, index) => (
                <div 
                  key={index}
                  className="p-4 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                        {company.name}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
                        {company.registered}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {company.location}
                      </span>
                      <span>•</span>
                      <span>{company.type}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                      Phone & Email Verified
                    </span>
                    <Link
                      href="/discover"
                      className="px-3 py-1 rounded text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      View Record →
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Counter */}
            <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-950/70 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Showing 3 of 148 verified fresh businesses in Tamil Nadu</span>
              <Link href="/discover" className="font-semibold text-zinc-900 dark:text-zinc-100 hover:underline">
                Explore all 148 results →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
