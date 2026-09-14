import Link from "next/link";
import { cn } from "@/lib/utils";

const samplePreviewBusinesses = [
  { name: "Apex Robotics & Automation", industry: "Robotics & AI", location: "Pune, MH", score: 92, status: "Verified", phone: true, email: true, credits: 1 },
  { name: "CloudScale Technologies", industry: "Cloud & IT", location: "Hyderabad, TS", score: 88, status: "Verified", phone: true, email: true, credits: 1 },
  { name: "BioGenix Life Sciences", industry: "Biotech & Pharma", location: "Ahmedabad, GJ", score: 85, status: "Verified", phone: true, email: false, credits: 1 },
  { name: "OmniPack Global Logistics", industry: "Logistics", location: "Gurugram, HR", score: 91, status: "Verified", phone: true, email: true, credits: 1 },
  { name: "Zenith Solar Structures", industry: "Clean Energy", location: "Ahmedabad, GJ", score: 84, status: "Verified", phone: true, email: false, credits: 1 },
  { name: "Sterling Infra Concretes", industry: "Civil Infrastructure", location: "Noida, UP", score: 89, status: "Verified", phone: true, email: true, credits: 1 },
];

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 rounded-full bg-zinc-200 overflow-hidden">
        <div className="h-full rounded-full bg-zinc-900" style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] font-semibold text-zinc-700">{score}</span>
    </div>
  );
}

export function HeroSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-32 pb-20 sm:pt-40 sm:pb-24 flex flex-col items-center text-center">
      <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-black dark:text-white sm:text-6xl fade-in-up">
        Discover High-Potential Businesses Before Your Competitors
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-300 fade-in-up animation-delay-100">
        AI-powered business discovery and lead intelligence platform. Find newly registered businesses, analyze their digital presence, and convert opportunities into clients.
      </p>
      
      <div className="mt-10 flex items-center justify-center gap-x-6 fade-in-up animation-delay-200">
        <Link
          href="/register"
          className="rounded-md bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-8 py-4 text-base font-semibold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black dark:focus-visible:outline-white transition-colors"
        >
          Start Free Trial
        </Link>
        <Link
          href="#demo"
          className="rounded-md bg-white text-zinc-900 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 dark:bg-black dark:text-white dark:ring-zinc-800 dark:hover:bg-zinc-900 px-8 py-4 text-base font-semibold shadow-sm transition-colors"
        >
          Watch Demo
        </Link>
      </div>
      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400 fade-in-up animation-delay-300">
        No credit card required • 5 daily free credits
      </p>

      <div className="mt-16 sm:mt-24 w-full max-w-5xl fade-in-up animation-delay-400">
        <div className="hero-mockup aspect-[16/9] w-full rounded-xl bg-white border border-zinc-200 shadow-2xl overflow-hidden relative flex flex-col max-h-[600px]">
          {/* Browser Chrome */}
          <div className="h-10 border-b border-zinc-200 bg-zinc-50 flex items-center px-4 gap-2 shrink-0">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-300"></div>
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-400"></div>
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-500"></div>
            </div>
            <div className="mx-auto flex items-center h-6 w-72 rounded-md bg-white border border-zinc-200 px-3">
              <svg className="h-3 w-3 text-zinc-400 mr-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.1.9-2 2-2h2a2 2 0 012 2v0a2 2 0 01-2 2h-2a2 2 0 01-2-2zm0 0V7a4 4 0 118 0v4" /></svg>
              <span className="text-[10px] text-zinc-500 truncate">app.orion.com/discover</span>
            </div>
          </div>
          
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <div className="w-44 border-r border-zinc-200 bg-zinc-50/50 py-4 px-3 hidden sm:flex flex-col shrink-0">
              <div className="flex items-center gap-2 px-2 mb-5">
                <div className="h-6 w-6 rounded-md bg-black flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">O</span>
                </div>
                <span className="text-xs font-bold text-zinc-900">Orion</span>
              </div>
              <nav className="space-y-0.5 text-[11px] font-medium">
                {[
                  { label: "Dashboard", icon: "📊", active: false },
                  { label: "Discover", icon: "🔍", active: true },
                  { label: "My Leads", icon: "👥", active: false },
                  { label: "Saved Searches", icon: "🔖", active: false },
                  { label: "Credits", icon: "⚡", active: false },
                  { label: "Settings", icon: "⚙️", active: false },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-1.5 rounded-md",
                      item.active ? "bg-zinc-900 text-white" : "text-zinc-600"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px]">{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                  </div>
                ))}
              </nav>
              <div className="mt-auto pt-4 border-t border-zinc-200">
                <div className="flex items-center gap-2 px-2">
                  <div className="h-6 w-6 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[9px] font-bold">
                    OP
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-900">Enterprise Team</div>
                    <div className="text-[9px] text-zinc-500">Active Workspace</div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Main Content Area */}
            <div className="flex-1 p-4 sm:p-5 overflow-hidden bg-zinc-50/30">
              {/* Top Bar */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 text-left">Discover Businesses</h3>
                  <p className="text-[10px] text-zinc-500 text-left">125,430 businesses found</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center h-7 px-2.5 rounded-md bg-white border border-zinc-200 text-[10px] text-zinc-400 gap-1.5">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <span>Search businesses...</span>
                  </div>
                  <div className="h-7 px-2.5 rounded-md bg-zinc-900 text-white text-[10px] font-semibold flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M3 4h18M3 8h12M3 12h8"/></svg>
                    Filters
                  </div>
                </div>
              </div>

              {/* Stats Mini Cards */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: "Daily Free", value: "5", trend: "Credits" },
                  { label: "Platform", value: "B2B", trend: "India" },
                  { label: "Search Engine", value: "PostgreSQL", trend: "Active" },
                  { label: "Zero-Cost", value: "Re-unlock", trend: "0 Credits" },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white rounded-lg border border-zinc-200 p-2">
                    <div className="text-[9px] text-zinc-500">{stat.label}</div>
                    <div className="flex items-end justify-between mt-0.5">
                      <span className="text-xs font-bold text-zinc-900">{stat.value}</span>
                      <span className="text-[9px] font-semibold text-zinc-700">{stat.trend}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Data Table */}
              <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden shadow-sm">
                {/* Table Header */}
                <div className="grid grid-cols-[1fr_80px_90px_60px_50px_50px_55px] gap-1 px-3 py-2 bg-zinc-50 border-b border-zinc-200 text-[9px] font-semibold text-zinc-500 uppercase tracking-wide">
                  <span>Business</span>
                  <span className="hidden sm:block">Industry</span>
                  <span className="hidden sm:block">Location</span>
                  <span>Score</span>
                  <span className="text-center">📞</span>
                  <span className="text-center">📧</span>
                  <span className="text-right">Action</span>
                </div>
                {/* Table Rows */}
                {samplePreviewBusinesses.map((biz, i) => (
                  <div
                    key={i}
                    className={cn(
                      "grid grid-cols-[1fr_80px_90px_60px_50px_50px_55px] gap-1 px-3 py-2 items-center border-b border-zinc-100 text-[10px]",
                      i === 0 && "bg-zinc-50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-6 w-6 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 bg-zinc-100 text-zinc-800 border border-zinc-200">
                        {biz.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-zinc-900 truncate">{biz.name}</div>
                        <div className="text-[9px] text-zinc-400 truncate sm:hidden">{biz.industry}</div>
                      </div>
                    </div>
                    <span className="text-zinc-600 truncate hidden sm:block">{biz.industry}</span>
                    <span className="text-zinc-500 truncate hidden sm:block">{biz.location}</span>
                    <ScoreBar score={biz.score} />
                    <div className="flex justify-center">
                      {biz.phone ? (
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-zinc-100 text-zinc-900 text-[8px] font-bold">✓</span>
                      ) : (
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-zinc-100 text-zinc-400 text-[8px]">✗</span>
                      )}
                    </div>
                    <div className="flex justify-center">
                      {biz.email ? (
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-zinc-100 text-zinc-900 text-[8px] font-bold">✓</span>
                      ) : (
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-zinc-100 text-zinc-400 text-[8px]">✗</span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      {i === 1 ? (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-zinc-100 text-zinc-900 border border-zinc-300">
                          Unlocked
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-zinc-900 text-white">
                          {biz.credits} Credit
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {/* Table Footer */}
                <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 text-[9px] text-zinc-500">
                  <span>Verified Indian Enterprise Registry</span>
                  <div className="flex gap-1">
                    <span className="px-2 py-0.5 rounded bg-zinc-900 text-white font-semibold">1</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Subtle glow effect */}
        <div className="absolute -inset-4 bg-gradient-to-r from-zinc-200/20 via-transparent to-zinc-200/20 rounded-2xl -z-10 blur-3xl pointer-events-none dark:hidden" />
      </div>
    </section>
  );
}
