'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Monitor, Laptop, Smartphone, ShieldAlert, Copy, Check, RotateCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface MobileResponsiveGuardProps {
  children: React.ReactNode;
}

// Regex to detect mobile devices from userAgent
const MOBILE_UA_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

function checkIsMobileOrSmallScreen(): { isBlocked: boolean; reason: string; width: number; height: number; isUA: boolean } {
  if (typeof window === 'undefined') {
    return { isBlocked: false, reason: '', width: 1440, height: 900, isUA: false };
  }

  const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 0;
  const isUA = MOBILE_UA_REGEX.test(navigator.userAgent || '');
  
  // Block if:
  // 1. Screen width is less than 1024px (standard desktop/laptop breakpoint)
  // 2. Or User Agent identifies as a mobile device
  if (isUA) {
    return {
      isBlocked: true,
      reason: 'Mobile device detected via browser signature.',
      width,
      height,
      isUA: true,
    };
  }

  if (width > 0 && width < 1024) {
    return {
      isBlocked: true,
      reason: `Screen width (${width}px) is below minimum desktop threshold (1024px).`,
      width,
      height,
      isUA: false,
    };
  }

  return {
    isBlocked: false,
    reason: '',
    width,
    height,
    isUA: false,
  };
}

export function MobileResponsiveGuard({ children }: MobileResponsiveGuardProps) {
  const [deviceInfo, setDeviceInfo] = useState<{
    isBlocked: boolean;
    reason: string;
    width: number;
    height: number;
    isUA: boolean;
  }>({
    isBlocked: false,
    reason: '',
    width: 1440,
    height: 900,
    isUA: false,
  });

  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleCopyLink = async () => {
    try {
      const url = window.location.href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied to clipboard! Open on your desktop or laptop.');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.info('Please copy the URL from your browser address bar.');
    }
  };

  const handleRefresh = () => {
    const info = checkIsMobileOrSmallScreen();
    setDeviceInfo(info);
    if (!info.isBlocked) {
      toast.success('Desktop viewport detected!');
    } else {
      toast.error('Device is still within mobile / restricted parameters.');
    }
  };

  return (
    <>
      {/* 
        1. Pure CSS fallback overlay:
        Guarantees that on viewports < 1024px, the mobile blocked message 
        is shown IMMEDIATELY even before React hydration, and desktop content is hidden.
      */}
      <div
        id="mobile-responsive-blocker"
        className={`fixed inset-0 z-[9999999] min-h-screen w-screen flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-950 text-slate-100 dark:bg-zinc-950 dark:text-zinc-100 ${
          mounted && deviceInfo.isBlocked
            ? 'flex !important'
            : 'max-lg:flex lg:hidden'
        }`}
        style={{
          // Extra safety to ensure no user interaction passes through
          touchAction: 'none',
        }}
      >
        {/* Subtle glowing ambient backdrop */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-indigo-600/15 dark:bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-rose-600/10 dark:bg-rose-500/10 rounded-full blur-3xl" />
        </div>

        {/* Central Modal Card */}
        <div className="relative w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/90 dark:border-zinc-800 dark:bg-zinc-900/90 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl text-center z-10 my-auto">
          {/* Top Restricted Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide bg-rose-500/10 text-rose-400 border border-rose-500/20 mb-6">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span>ACCESS RESTRICTED &bull; DESKTOP ONLY</span>
          </div>

          {/* Visual Device Indicator Graphic */}
          <div className="flex items-center justify-center gap-4 mb-6">
            {/* Desktop / Laptop (Allowed) */}
            <div className="relative flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
                <Laptop className="w-8 h-8" />
              </div>
              <span className="mt-2 text-[11px] font-medium text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Supported
              </span>
            </div>

            {/* Separator / Arrow */}
            <div className="text-slate-600 dark:text-zinc-600 font-mono text-sm">
              &mdash; VS &mdash;
            </div>

            {/* Smartphone (Blocked) */}
            <div className="relative flex flex-col items-center">
              <div className="relative w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-lg shadow-rose-500/10">
                <Smartphone className="w-8 h-8" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-10 h-0.5 bg-rose-500 rotate-45 rounded-full shadow" />
                </div>
              </div>
              <span className="mt-2 text-[11px] font-medium text-rose-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                Blocked
              </span>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-3">
            Mobile Responsive Blocked
          </h1>

          {/* Core Message */}
          <p className="text-sm sm:text-base text-slate-300 dark:text-zinc-300 leading-relaxed mb-6 font-normal">
            This platform is not available on mobile devices. To ensure precision, high-density data analytics, and full operational capability, access is restricted to desktop and laptop devices.
          </p>

          {/* Compatibility Breakdown Box */}
          <div className="rounded-2xl bg-slate-950/60 dark:bg-zinc-950/60 border border-slate-800/80 dark:border-zinc-800/80 p-4 text-left mb-6 space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-400 mb-2">
              Device Compatibility Policy
            </div>
            
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-200 dark:text-zinc-200">
                <Monitor className="w-4 h-4 text-emerald-400" />
                <span>Desktop Computers (PC / Mac / Linux)</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Available
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-200 dark:text-zinc-200">
                <Laptop className="w-4 h-4 text-emerald-400" />
                <span>Laptops &amp; Notebooks (1024px+ screen)</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Available
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-rose-300 dark:text-rose-400">
                <Smartphone className="w-4 h-4 text-rose-400" />
                <span>Mobile Phones &amp; Small Displays</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                Blocked
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-sm transition-all duration-150 shadow-lg shadow-indigo-600/25"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Link Copied!' : 'Copy Link for Desktop'}</span>
            </button>

            <button
              onClick={handleRefresh}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-300 hover:text-white font-medium text-sm transition-all duration-150"
              title="Check screen dimensions again"
            >
              <RotateCw className="w-4 h-4" />
              <span>Check Again</span>
            </button>
          </div>

          {/* Live Diagnostic Footer */}
          {mounted && (
            <div className="mt-6 pt-4 border-t border-slate-800/80 dark:border-zinc-800/80 text-[11px] text-slate-500 dark:text-zinc-500 flex flex-wrap items-center justify-between gap-2">
              <span>
                Detected: {deviceInfo.width} &times; {deviceInfo.height} px
              </span>
              <span>Min Required: 1024px</span>
            </div>
          )}
        </div>
      </div>

      {/* 
        2. Website Content Wrapper:
        - CSS: 'max-lg:hidden' ensures that on screen widths < 1024px, 
          the website content is never rendered or reachable.
        - JS: If device is detected as mobile via UA (even if simulated with large resolution),
          deviceInfo.isBlocked completely removes or hides the content.
      */}
      <div
        id="desktop-website-container"
        className={`w-full min-h-screen ${
          mounted && deviceInfo.isBlocked
            ? 'hidden !important'
            : 'max-lg:hidden lg:block'
        }`}
        aria-hidden={mounted ? deviceInfo.isBlocked : undefined}
      >
        {children}
      </div>
    </>
  );
}
