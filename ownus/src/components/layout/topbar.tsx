'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Search, 
  Users, 
  BookmarkCheck, 
  Zap, 
  Sun, 
  Moon, 
  Bell, 
  Settings, 
  Shield 
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

const TOP_NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Discover', icon: Search, href: '/discover' },
  { label: 'My Leads', icon: Users, href: '/leads' },
  { label: 'Saved Searches', icon: BookmarkCheck, href: '/saved-searches' },
  { label: 'Credits', icon: Zap, href: '/credits' },
];

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, wallet, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  const displayName = user?.name || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Orion User';
  const displayEmail = user?.email || 'user@orion.ai';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'OU';

  const creditBalance = wallet?.balance ?? 25;

  const handleSignOut = async () => {
    setDropdownOpen(false);
    await logout();
    router.push('/login');
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-black/95 backdrop-blur-md px-4 sm:px-6 transition-all">
      
      {/* Left: Brand Logo + Divider */}
      <div className="flex items-center gap-4 shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl overflow-hidden cursor-pointer">
          <img src="/white.png" alt="Orion Logo" className="h-7 w-auto dark:hidden" />
          <img src="/black.png" alt="Orion Logo" className="h-7 w-auto hidden dark:block" />
        </Link>
        <div className="h-5 w-px bg-zinc-200 dark:border-zinc-800 hidden md:block" />
      </div>

      {/* Center: Horizontal Navigation Links */}
      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none py-1 mx-4">
        {TOP_NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer',
                isActive
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', isActive ? 'text-white dark:text-zinc-900' : 'text-zinc-400 dark:text-zinc-500')} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Right: Credits, Theme, Notifications & Profile */}
      <div className="flex items-center gap-2.5 shrink-0">
        
        {/* Credits Badge */}
        <Link
          href="/credits"
          title={`Available: ${creditBalance} (Daily: ${wallet?.dailyCredits ?? 5} | Purchased: ${wallet?.purchasedCredits ?? 0})`}
          className="hidden sm:inline-flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 transition-colors"
        >
          <Zap className="h-3.5 w-3.5 text-zinc-900 dark:text-white fill-current" />
          <span>{creditBalance.toLocaleString()} Credits</span>
          <span className="text-[10px] text-zinc-400 font-mono hidden md:inline">
            ({wallet?.dailyCredits ?? 5}d + {wallet?.purchasedCredits ?? 0}p)
          </span>
        </Link>

        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Notifications */}
        <button 
          type="button"
          className="relative text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-white"></span>
        </button>

        {/* User Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button 
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-xs font-bold text-white dark:text-zinc-900 hover:opacity-90 transition-opacity cursor-pointer"
          >
            {initials}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl py-1 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
              <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
                <p className="text-xs font-semibold text-zinc-900 dark:text-white">{displayName}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{displayEmail}</p>
              </div>
              <div className="py-1">
                <Link 
                  href="/settings" 
                  className="block px-4 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  Account Settings
                </Link>
                <Link 
                  href="/admin" 
                  className="block px-4 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  Admin Console
                </Link>
              </div>
              <div className="border-t border-zinc-200 dark:border-zinc-800 py-1">
                <button 
                  onClick={handleSignOut}
                  className="w-full text-left block px-4 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
