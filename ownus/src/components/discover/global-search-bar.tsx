"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, X, Building2, MapPin, Tag, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Business } from "@/lib/types";

interface GlobalSearchBarProps {
  value: string;
  onChange: (val: string) => void;
  businesses: Business[];
  onSelectSuggestion?: (type: "business" | "industry" | "city", value: string) => void;
  className?: string;
}

export function GlobalSearchBar({
  value,
  onChange,
  businesses,
  onSelectSuggestion,
  className,
}: GlobalSearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Global ⌘K / Ctrl+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculate matching suggestions
  const suggestions = React.useMemo(() => {
    if (!value.trim() || value.length < 2) return null;
    const query = value.toLowerCase();

    const matchingBusinesses = businesses
      .filter((b) => b.name.toLowerCase().includes(query))
      .slice(0, 4);

    const matchingIndustries = Array.from(
      new Set(
        businesses
          .filter((b) => b.industry?.toLowerCase().includes(query))
          .map((b) => b.industry)
      )
    ).slice(0, 3);

    const matchingCities = Array.from(
      new Set(
        businesses
          .filter((b) => b.city?.toLowerCase().includes(query))
          .map((b) => `${b.city}, ${b.state}`)
      )
    ).slice(0, 3);

    const hasResults =
      matchingBusinesses.length > 0 ||
      matchingIndustries.length > 0 ||
      matchingCities.length > 0;

    return hasResults
      ? {
          businesses: matchingBusinesses,
          industries: matchingIndustries,
          cities: matchingCities,
        }
      : null;
  }, [value, businesses]);

  const handleSelect = (type: "business" | "industry" | "city", val: string) => {
    onChange(val);
    setIsOpen(false);
    if (onSelectSuggestion) {
      onSelectSuggestion(type, val);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search by business name, industry, category, city, or district..."
          className="h-10 w-full rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 pl-10 pr-24 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-xs focus:border-black dark:focus:border-white focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white transition-all"
        />
        <div className="absolute right-3 flex items-center gap-1.5">
          {value && (
            <button
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-800 px-1.5 font-mono text-[10px] font-medium text-gray-400 dark:text-gray-500">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </div>

      {/* Suggestions Popover */}
      {isOpen && suggestions && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[380px] overflow-y-auto rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2 shadow-xl animate-in fade-in-50 zoom-in-95">
          {/* Businesses */}
          {suggestions.businesses.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Businesses
              </div>
              {suggestions.businesses.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleSelect("business", b.name)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors group"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Building2 className="h-4 w-4 text-gray-400 shrink-0 group-hover:text-black dark:group-hover:text-white" />
                    <span className="truncate font-medium">{b.name}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">({b.city}, {b.state})</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 shrink-0">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">{b.opportunityScore}% score</span>
                    <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Industries */}
          {suggestions.industries.length > 0 && (
            <div className="mb-2 border-t border-gray-100 dark:border-neutral-800/80 pt-2">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Industries
              </div>
              {suggestions.industries.map((ind) => (
                <button
                  key={ind}
                  onClick={() => handleSelect("industry", ind)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <Tag className="h-4 w-4 text-gray-400 shrink-0 group-hover:text-black dark:group-hover:text-white" />
                    <span>Industry: <strong className="text-gray-900 dark:text-white">{ind}</strong></span>
                  </div>
                  <span className="text-xs text-gray-400">Filter by industry</span>
                </button>
              ))}
            </div>
          )}

          {/* Locations */}
          {suggestions.cities.length > 0 && (
            <div className="border-t border-gray-100 dark:border-neutral-800/80 pt-2">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Locations
              </div>
              {suggestions.cities.map((city) => (
                <button
                  key={city}
                  onClick={() => handleSelect("city", city.split(",")[0])}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <MapPin className="h-4 w-4 text-gray-400 shrink-0 group-hover:text-black dark:group-hover:text-white" />
                    <span>Location: <strong className="text-gray-900 dark:text-white">{city}</strong></span>
                  </div>
                  <span className="text-xs text-gray-400">Filter by city</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-1 flex items-center justify-between border-t border-gray-100 dark:border-neutral-800 px-2 pt-2 text-[11px] text-gray-400">
            <span>Press <kbd className="font-mono bg-gray-100 dark:bg-neutral-800 px-1 rounded">Enter</kbd> to search</span>
            <span>Press <kbd className="font-mono bg-gray-100 dark:bg-neutral-800 px-1 rounded">Esc</kbd> to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
