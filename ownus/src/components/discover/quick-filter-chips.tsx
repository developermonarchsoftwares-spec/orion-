"use client";

import React from "react";
import { 
  Sparkles, 
  Globe, 
  Globe2, 
  Mail, 
  Phone, 
  ShieldCheck, 
  TrendingUp, 
  Calendar,
  Check
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuickFilterChip {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export const UNIVERSAL_QUICK_FILTERS: QuickFilterChip[] = [
  { id: "new_today", label: "New Today", icon: Sparkles },
  { id: "added_this_week", label: "Added This Week", icon: Calendar },
  { id: "added_this_month", label: "Added This Month", icon: Calendar },
  { id: "no_website", label: "No Website", icon: Globe2 },
  { id: "has_website", label: "Has Website", icon: Globe },
  { id: "has_email", label: "Has Email", icon: Mail },
  { id: "has_phone", label: "Has Phone", icon: Phone },
  { id: "verified", label: "Verified", icon: ShieldCheck },
  { id: "high_orion_score", label: "High Orion Score", icon: TrendingUp },
];

interface QuickFilterChipsProps {
  activeChips: string[];
  onToggleChip: (chipId: string) => void;
  className?: string;
}

export function QuickFilterChips({
  activeChips,
  onToggleChip,
  className,
}: QuickFilterChipsProps) {
  return (
    <div className={cn("flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none py-1", className)}>
      <div className="flex items-center gap-1.5 shrink-0">
        {UNIVERSAL_QUICK_FILTERS.map((chip) => {
          const isActive = activeChips.includes(chip.id);
          const Icon = chip.icon;

          return (
            <button
              key={chip.id}
              onClick={() => onToggleChip(chip.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap border shrink-0 cursor-pointer",
                isActive
                  ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white shadow-xs font-semibold"
                  : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
              )}
            >
              {isActive ? (
                <Check className="h-3 w-3 shrink-0" />
              ) : (
                Icon && <Icon className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
              )}
              <span>{chip.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
