'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type ThemeMode = 'dark' | 'light';

interface AdminThemeContextType {
  adminTheme: ThemeMode;
  isDark: boolean;
  setAdminTheme: (theme: ThemeMode) => void;
  toggleAdminTheme: () => void;
}

const AdminThemeContext = createContext<AdminThemeContextType | undefined>(undefined);

const ADMIN_THEME_STORAGE_KEY = 'orion_admin_theme';
const CUSTOMER_THEME_STORAGE_KEY = 'theme';

function getInitialAdminTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return 'dark';
}

function restoreCustomerTheme() {
  if (typeof window === 'undefined') return;
  try {
    const customerTheme = localStorage.getItem(CUSTOMER_THEME_STORAGE_KEY) || 'system';
    let targetClass: ThemeMode;
    if (customerTheme === 'dark' || customerTheme === 'light') {
      targetClass = customerTheme;
    } else {
      targetClass = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(targetClass);
    root.style.colorScheme = targetClass;
  } catch {}
}

export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  const [adminTheme, setAdminThemeState] = useState<ThemeMode>(getInitialAdminTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = getInitialAdminTheme();
    setAdminThemeState(saved);

    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(saved);
    root.style.colorScheme = saved;

    // Listen only to admin theme changes across tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === ADMIN_THEME_STORAGE_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setAdminThemeState(e.newValue);
        root.classList.remove('dark', 'light');
        root.classList.add(e.newValue);
        root.style.colorScheme = e.newValue;
      }
      // Customer theme changes in storage (e.key === 'theme') are intentionally ignored
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
      // When leaving the admin panel, restore the customer portal's theme
      restoreCustomerTheme();
    };
  }, []);

  const setAdminTheme = (theme: ThemeMode) => {
    setAdminThemeState(theme);
    try {
      localStorage.setItem(ADMIN_THEME_STORAGE_KEY, theme);
    } catch {}

    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    root.style.colorScheme = theme;
    // CRITICAL: We NEVER touch 'theme' in localStorage or next-themes.
    // This ensures customer-facing pages remain completely unaffected.
  };

  const toggleAdminTheme = () => {
    setAdminTheme(adminTheme === 'dark' ? 'light' : 'dark');
  };

  const isDark = mounted ? adminTheme === 'dark' : true;

  return (
    <AdminThemeContext.Provider value={{ adminTheme, isDark, setAdminTheme, toggleAdminTheme }}>
      <div className={`admin-portal ${isDark ? 'dark' : ''} min-h-screen w-full`}>
        {children}
      </div>
    </AdminThemeContext.Provider>
  );
}

export function useAdminTheme(): AdminThemeContextType {
  const context = useContext(AdminThemeContext);
  if (!context) {
    return {
      adminTheme: 'dark',
      isDark: true,
      setAdminTheme: () => {},
      toggleAdminTheme: () => {},
    };
  }
  return context;
}
