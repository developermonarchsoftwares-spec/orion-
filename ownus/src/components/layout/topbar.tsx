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
  Shield,
  ShieldCheck,
  Check,
  CheckCheck,
  X,
  Sparkles,
  Trash2,
  ExternalLink
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

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  timestamp: number;
  read: boolean;
  type: 'credit' | 'lead' | 'system' | 'security';
  link?: string;
}

const DEFAULT_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif-1',
    title: 'Daily Credits Ready',
    message: 'Your 5 daily lead intelligence credits are replenished and ready to unlock verified contacts.',
    time: 'Just now',
    timestamp: Date.now() - 1000 * 60 * 5,
    read: false,
    type: 'credit',
    link: '/credits',
  },
  {
    id: 'notif-2',
    title: 'New Lead Matches',
    message: '14 new verified companies and decision-maker contacts added matching your target criteria.',
    time: '2h ago',
    timestamp: Date.now() - 1000 * 60 * 120,
    read: false,
    type: 'lead',
    link: '/discover',
  },
  {
    id: 'notif-3',
    title: 'Workspace Protected',
    message: 'Single sign-on session authenticated and security policies verified.',
    time: 'Yesterday',
    timestamp: Date.now() - 1000 * 60 * 60 * 24,
    read: true,
    type: 'security',
    link: '/settings',
  },
];

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, wallet, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>(DEFAULT_NOTIFICATIONS);

  const { resolvedTheme, setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isDark = mounted ? (resolvedTheme === 'dark' || theme === 'dark') : true;

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem('orion_user_notifications');
      if (saved) {
        setNotifications(JSON.parse(saved));
      } else {
        localStorage.setItem('orion_user_notifications', JSON.stringify(DEFAULT_NOTIFICATIONS));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const saveNotifications = (items: AppNotification[]) => {
    setNotifications(items);
    try {
      localStorage.setItem('orion_user_notifications', JSON.stringify(items));
    } catch {}
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = () => {
    const updated = notifications.map(n => ({ ...n, read: true }));
    saveNotifications(updated);
  };

  const handleMarkOneRead = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const updated = notifications.map(n => n.id === id ? { ...n, read: true } : n);
    saveNotifications(updated);
  };

  const handleClearAll = () => {
    saveNotifications([]);
  };

  const handleNotificationClick = (notif: AppNotification) => {
    handleMarkOneRead(notif.id);
    setNotificationsOpen(false);
    if (notif.link) {
      router.push(notif.link);
    }
  };

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
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
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

        {/* Notifications Dropdown Trigger & Panel */}
        <div className="relative" ref={notifRef}>
          <button 
            type="button"
            onClick={() => {
              setNotificationsOpen(prev => !prev);
              setDropdownOpen(false);
            }}
            aria-label="View notifications"
            aria-expanded={notificationsOpen}
            title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'Notifications'}
            className={cn(
              "relative text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer",
              notificationsOpen && "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white"
            )}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600 dark:bg-indigo-400"></span>
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl z-50 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
              {/* Dropdown Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
                    Notifications
                  </h3>
                  {unreadCount > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                      {unreadCount} new
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      title="Mark all as read"
                      className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white px-2 py-0.5 rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotificationsOpen(false)}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Notification Items List */}
              <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center px-4">
                    <Bell className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-700 mb-2 stroke-[1.5]" />
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">All caught up</p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">We'll alert you when daily credits reset or saved searches find new leads.</p>
                  </div>
                ) : (
                  notifications.map((notif) => {
                    const isUnread = !notif.read;
                    return (
                      <div
                        key={notif.id}
                        onClick={() => handleNotificationClick(notif)}
                        className={cn(
                          "group relative flex items-start gap-3 p-3.5 transition-colors cursor-pointer text-left",
                          isUnread
                            ? "bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                        )}
                      >
                        {/* Status Icon */}
                        <div className={cn(
                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                          notif.type === 'credit' && "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400",
                          notif.type === 'lead' && "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400",
                          notif.type === 'security' && "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400",
                          notif.type === 'system' && "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400"
                        )}>
                          {notif.type === 'credit' && <Zap className="h-3.5 w-3.5 fill-current" />}
                          {notif.type === 'lead' && <Search className="h-3.5 w-3.5" />}
                          {notif.type === 'security' && <ShieldCheck className="h-3.5 w-3.5" />}
                          {notif.type === 'system' && <Sparkles className="h-3.5 w-3.5" />}
                        </div>

                        {/* Text Content */}
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <p className={cn(
                              "text-xs truncate",
                              isUnread ? "font-bold text-zinc-900 dark:text-white" : "font-medium text-zinc-700 dark:text-zinc-300"
                            )}>
                              {notif.title}
                            </p>
                            {isUnread && (
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0"></span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-0.5 leading-relaxed">
                            {notif.message}
                          </p>
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono mt-1 block">
                            {notif.time}
                          </span>
                        </div>

                        {/* Quick Mark Read Button */}
                        {isUnread && (
                          <button
                            type="button"
                            onClick={(e) => handleMarkOneRead(notif.id, e)}
                            title="Mark as read"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shrink-0 cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Dropdown Footer */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50">
                <Link
                  href="/settings"
                  onClick={() => setNotificationsOpen(false)}
                  className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                >
                  Notification Preferences
                </Link>

                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-[11px] text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button 
            type="button"
            onClick={() => {
              setDropdownOpen(!dropdownOpen);
              setNotificationsOpen(false);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-xs font-bold text-white dark:text-zinc-900 hover:opacity-90 transition-opacity cursor-pointer overflow-hidden"
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
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

