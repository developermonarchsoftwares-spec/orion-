'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Search,
  Users,
  BookmarkCheck,
  Zap,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Discover', icon: Search, href: '/discover' },
  { label: 'My Leads', icon: Users, href: '/leads' },
  { label: 'Saved Searches', icon: BookmarkCheck, href: '/saved-searches' },
  { label: 'Credits', icon: Zap, href: '/credits' },
];

const FOOTER_NAV_ITEMS = [
  { label: 'Settings', icon: Settings, href: '/settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 z-40 h-screen border-r border-gray-200 dark:border-neutral-900 bg-white dark:bg-black transition-all duration-200 flex flex-col',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-14 items-center border-b border-gray-200 dark:border-neutral-900 px-4 shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl text-primary overflow-hidden">
          {collapsed ? (
            <span className="w-8 text-center text-primary font-bold">O</span>
          ) : (
            <div className="flex items-center shrink-0">
              <img src="/white.png" alt="Orion Logo" className="h-7 w-auto dark:hidden" />
              <img src="/black.png" alt="Orion Logo" className="h-7 w-auto hidden dark:block" />
            </div>
          )}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors relative group',
                isActive
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white',
                collapsed && 'justify-center px-0'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible whitespace-nowrap z-50">
                  {item.label}
                </div>
              )}
            </Link>
          );
        })}

        <div className="mt-auto"></div>

        <div className="px-2 mb-2 flex items-center justify-center">
          {collapsed ? (
            <div className="p-2 bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-full border border-zinc-200 dark:border-zinc-800" title="Credits: 2,450">
              <Zap className="h-4 w-4" />
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white px-3 py-2 rounded-md w-full text-sm font-semibold border border-zinc-200 dark:border-zinc-800">
              <Zap className="h-4 w-4 fill-current" />
              <span>2,450 Credits</span>
            </div>
          )}
        </div>

        <div className="my-2 h-px bg-zinc-200 dark:bg-zinc-800 mx-2" />

        {FOOTER_NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors relative group',
                isActive
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white',
                collapsed && 'justify-center px-0'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 dark:bg-neutral-800 text-white text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible whitespace-nowrap z-50">
                  {item.label}
                </div>
              )}
            </Link>
          );
        })}
      </div>

      <div className="border-t border-gray-200 dark:border-neutral-900 p-2 shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-md p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-900 transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
