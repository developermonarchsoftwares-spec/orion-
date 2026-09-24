import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export function CTASection() {
  return (
    <section className="py-20 sm:py-28 bg-white dark:bg-black">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-zinc-950 dark:bg-zinc-900 px-6 py-20 sm:px-16 sm:py-24 text-center shadow-2xl border border-zinc-800">
          {/* Subtle background glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-zinc-800/40 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 mb-6 border border-zinc-700">
              <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
              Get Ahead of the Market
            </div>

            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Your Next Lead Could Be a New Business.
            </h2>
            <p className="mt-6 text-lg sm:text-xl leading-8 text-zinc-400">
              Start discovering relevant businesses across India with Ownus.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-white text-black dark:bg-white dark:text-black hover:bg-zinc-100 dark:hover:bg-zinc-200 px-8 py-4 text-base font-bold shadow-md transition-all transform hover:scale-105"
              >
                <span className="text-black dark:text-black font-bold">Start Discovering</span>
                <ArrowRight className="w-4 h-4 text-black dark:text-black" />
              </Link>
              <Link
                href="/discover"
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white border border-zinc-700 hover:bg-zinc-800 dark:hover:bg-zinc-700 px-8 py-4 text-base font-semibold shadow-sm transition-colors"
              >
                View Demo
              </Link>
            </div>

            <p className="mt-6 text-xs text-zinc-500 font-medium">
              Free credits included • No credit card required • Instant search
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
