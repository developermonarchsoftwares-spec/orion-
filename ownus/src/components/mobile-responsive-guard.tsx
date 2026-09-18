'use client';

import React, { useEffect, useState } from 'react';
import { Laptop } from 'lucide-react';

interface MobileResponsiveGuardProps {
  children: React.ReactNode;
}

// Regex to detect mobile devices from userAgent
const MOBILE_UA_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

function checkIsMobileOrSmallScreen(): { isBlocked: boolean; width: number } {
  if (typeof window === 'undefined') {
    return { isBlocked: false, width: 1440 };
  }

  const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0;
  const isUA = MOBILE_UA_REGEX.test(navigator.userAgent || '');
  
  // Block if:
  // 1. Screen width is less than 1024px (standard desktop/laptop breakpoint)
  // 2. Or User Agent identifies as a mobile device
  if (isUA || (width > 0 && width < 1024)) {
    return { isBlocked: true, width };
  }

  return { isBlocked: false, width };
}

export function MobileResponsiveGuard({ children }: MobileResponsiveGuardProps) {
  const [deviceInfo, setDeviceInfo] = useState<{ isBlocked: boolean; width: number }>({
    isBlocked: false,
    width: 1440,
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const updateCheck = () => {
      const info = checkIsMobileOrSmallScreen();
      setDeviceInfo(info);

      if (info.isBlocked) {
        document.documentElement.classList.add('mobile-blocked');
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.height = '100%';
      } else {
        document.documentElement.classList.remove('mobile-blocked');
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.height = '';
      }
    };

    updateCheck();

    window.addEventListener('resize', updateCheck, { passive: true });
    window.addEventListener('orientationchange', updateCheck, { passive: true });

    return () => {
      window.removeEventListener('resize', updateCheck);
      window.removeEventListener('orientationchange', updateCheck);
      document.documentElement.classList.remove('mobile-blocked');
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
    };
  }, []);

  return (
    <>
      {/* 
        Mobile Responsive Access Restriction Screen:
        Displays ONLY the UI elements specified in the exact design:
        1. "ACCESS RESTRICTED • DESKTOP ONLY" pill badge
        2. Supported (Laptop) vs Blocked (Phone with slash) device cards
        3. "Mobile Responsive Blocked" heading
        4. Operational explanatory paragraph
      */}
      <div
        id="mobile-responsive-blocker"
        className={`fixed inset-0 z-[99999999] min-h-screen w-screen flex-col items-center justify-center p-5 sm:p-6 overflow-y-auto bg-[#070A11] text-zinc-100 ${
          mounted && deviceInfo.isBlocked
            ? 'flex !important'
            : 'max-lg:flex lg:hidden'
        }`}
        style={{
          touchAction: 'none',
        }}
      >
        {/* Ambient background glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-950/20 rounded-full blur-3xl" />
        </div>

        {/* Access Restriction Card */}
        <div className="relative w-full max-w-[440px] rounded-[28px] border border-[#1A2333] bg-[#0E1420]/95 p-7 sm:p-9 shadow-2xl backdrop-blur-2xl text-center z-10 my-auto">
          {/* 1. Restricted Pill Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[11px] font-bold tracking-wider bg-[#28121B] text-[#FF5A79] border border-[#481B26] mb-7">
            <span className="w-2 h-2 rounded-full bg-[#FF3B5C]" />
            <span>ACCESS RESTRICTED &bull; DESKTOP ONLY</span>
          </div>

          {/* 2. Visual Device Indicator: Supported (Laptop) vs Blocked (Phone with slash) */}
          <div className="flex items-center justify-center gap-4 sm:gap-6 mb-7">
            {/* Desktop / Laptop - Supported */}
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 sm:w-[70px] sm:h-[70px] rounded-2xl bg-[#09221B] border border-[#10B981]/40 flex items-center justify-center text-[#10B981] shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                <Laptop className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-[#10B981]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                <span>Supported</span>
              </div>
            </div>

            {/* Separator */}
            <div className="text-zinc-500 font-mono text-xs font-medium tracking-widest px-1">
              &mdash; VS &mdash;
            </div>

            {/* Mobile Phone - Blocked */}
            <div className="flex flex-col items-center">
              <div className="relative w-16 h-16 sm:w-[70px] sm:h-[70px] rounded-2xl bg-[#281119] border border-[#F43F5E]/40 flex items-center justify-center text-[#F43F5E] shadow-[0_0_20px_rgba(244,63,94,0.15)]">
                <svg
                  className="w-7 h-7 sm:w-8 sm:h-8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="13" height="19" x="5.5" y="2.5" rx="2.5" />
                  <circle cx="12" cy="18" r="0.6" fill="currentColor" />
                  <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2.2" />
                </svg>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-[#F43F5E]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F43F5E]" />
                <span>Blocked</span>
              </div>
            </div>
          </div>

          {/* 3. Title */}
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-3">
            Mobile Responsive Blocked
          </h1>

          {/* 4. Explanatory Message */}
          <p className="text-[13px] sm:text-sm text-zinc-300 leading-relaxed font-normal">
            This platform is not available on mobile devices. To ensure precision, high-density data analytics, and full operational capability, access is restricted to desktop and laptop devices.
          </p>
        </div>
      </div>

      {/* 
        Website Content Wrapper:
        Completely hides and prevents access to all other website content on mobile devices.
        When blocked, content is fully hidden via CSS (display: none !important) and 
        unmounted in React to prevent any background interactions, scrolling, or inspection.
      */}
      {(!mounted || !deviceInfo.isBlocked) && (
        <div
          id="desktop-website-container"
          className="w-full min-h-screen max-lg:hidden lg:block"
        >
          {children}
        </div>
      )}
    </>
  );
}
