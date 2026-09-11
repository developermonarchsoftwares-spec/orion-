export function LogoBar() {
  const logos = [
    "TechVentures",
    "GrowthLabs",
    "ScaleUp Co",
    "Innovate Inc",
    "DataFlow",
    "NextGen Digital",
  ];

  return (
    <div className="border-y border-gray-200 dark:border-neutral-900 bg-white dark:bg-black py-12">
      <div className="mx-auto max-w-7xl px-4 text-center">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Trusted by 2,000+ businesses worldwide
        </p>
        <div className="mt-8 overflow-hidden flex w-full relative group">
          <div className="flex animate-scroll w-max group-hover:[animation-play-state:paused]">
            {[...logos, ...logos, ...logos, ...logos].map((logo, index) => (
              <div
                key={index}
                className="text-xl font-bold text-gray-900 dark:text-gray-300 uppercase tracking-wider px-6 lg:px-10 whitespace-nowrap shrink-0"
              >
                {logo}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
