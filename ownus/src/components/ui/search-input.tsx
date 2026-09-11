"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  onChange?: (value: string) => void;
  debounceMs?: number;
}

export function SearchInput({
  className,
  onChange,
  debounceMs = 300,
  value: externalValue,
  placeholder = "Search...",
  ...props
}: SearchInputProps) {
  const [value, setValue] = React.useState(
    (externalValue as string) || ""
  );

  React.useEffect(() => {
    if (externalValue !== undefined) {
      setValue(externalValue as string);
    }
  }, [externalValue]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (onChange) {
        onChange(value);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [value, debounceMs, onChange]);

  // Keyboard shortcut listener
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleClear = () => {
    setValue("");
    if (onChange) {
      onChange("");
    }
    document.getElementById("search-input")?.focus();
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="absolute left-3 h-4 w-4 text-text-secondary" />
      <input
        id="search-input"
        type="text"
        className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-20 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        {...props}
      />
      
      <div className="absolute right-2 flex items-center space-x-1">
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-border transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-surface px-1.5 font-mono text-[10px] font-medium text-text-secondary">
          <span className="text-xs">âŒ˜</span>K
        </kbd>
      </div>
    </div>
  );
}
