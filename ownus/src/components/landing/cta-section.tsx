import Link from "next/link";

export function CTASection() {
  return (
    <section className="py-20 sm:py-24 bg-gray-50 dark:bg-black">
      <div className="mx-auto max-w-7xl px-4">
        <div className="bg-white dark:bg-black border border-gray-200 dark:border-neutral-800 rounded-3xl py-20 px-6 sm:px-12 text-center shadow-xl relative overflow-hidden">
          <div className="relative z-10 max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-5xl mb-6">
              Ready to discover your next client?
            </h2>
            <p className="mt-4 text-lg leading-8 text-gray-600 dark:text-gray-300">
              Join 2,000+ businesses using Orion to find and convert new opportunities.
            </p>
            <div className="flex flex-col items-center gap-y-4 mt-8">
              <Link
                href="/register"
                className="rounded-md bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200 px-8 py-4 text-base font-bold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black dark:focus-visible:outline-white transition-all transform hover:scale-105"
              >
                Start Free Trial
              </Link>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                No credit card required
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
