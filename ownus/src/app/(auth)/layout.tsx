import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Branding Panel - Hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-50 dark:bg-black border-r border-gray-200 dark:border-neutral-900 flex-col p-12 text-gray-900 dark:text-white relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute inset-0 z-0 opacity-40 dark:opacity-20 pointer-events-none">
          <svg className="absolute w-full h-full text-gray-300 dark:text-neutral-800" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-gray-200/50 dark:bg-neutral-800/30 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-gray-200/40 dark:bg-neutral-800/30 rounded-full blur-3xl translate-x-1/4 translate-y-1/4" />

        <div className="relative z-10 mb-2">
          <Link href="/" className="inline-flex flex-col items-start gap-1">
            <div className="flex items-center">
              <img src="/white.png" alt="Orion Logo" className="h-10 w-auto dark:hidden" />
              <img src="/black.png" alt="Orion Logo" className="h-10 w-auto hidden dark:block" />
            </div>
            <span className="text-[9px] font-semibold tracking-[0.2em] text-gray-400 dark:text-neutral-500 uppercase select-none">
              A MONARCH SOFTWARES PRODUCT
            </span>
          </Link>
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center max-w-lg">
          <h2 className="text-5xl font-bold leading-tight mb-6 text-gray-900 dark:text-white">
            Discover. Analyze. Convert.
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-xl font-light">
            AI-powered business discovery and lead intelligence platform for modern revenue teams.
          </p>
        </div>
        
        <div className="relative z-10 mt-auto text-gray-500 dark:text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} Orion Inc. All rights reserved.
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 bg-white dark:bg-black text-gray-900 dark:text-white">
        <div className="w-full max-w-md">
          {children}
        </div>
      </div>
    </div>
  );
}
