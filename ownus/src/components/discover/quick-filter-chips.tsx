"use client";

import React, { useMemo } from "react";
import { 
  Sparkles, 
  Globe, 
  Globe2, 
  Mail, 
  Phone, 
  ShieldCheck, 
  TrendingUp, 
  Calendar,
  Check,
  Tag,
  Star,
  Zap,
  Award,
  Filter
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFilterOptions } from "@/lib/filter-options-store";

export interface QuickFilterChip {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles,
  Globe,
  Globe2,
  Mail,
  Phone,
  ShieldCheck,
  TrendingUp,
  Calendar,
  Tag,
  Star,
  Zap,
  Award,
  Filter,
};

export function QuickFilterChips({
  activeChips,
  onToggleChip,
  className,
}: {
  activeChips: string[];
  onToggleChip: (chipId: string) => void;
  className?: string;
}) {
  const { config } = useFilterOptions();

  const quickFilterCategory = useMemo(() => {
    return config.categories.find((c) => c.id === "quick_filters");
  }, [config]);

  const dynamicChips: QuickFilterChip[] = useMemo(() => {
    if (!quickFilterCategory || !quickFilterCategory.options) return [];
    return quickFilterCategory.options
      .filter((opt) => opt.isActive !== false)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map((opt) => {
        const IconComponent = opt.iconName ? ICON_MAP[opt.iconName] || Tag : Tag;
        return {
          id: opt.value || opt.id,
          label: opt.label,
          icon: IconComponent,
        };
      });
  }, [quickFilterCategory]);

  if (dynamicChips.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none py-1", className)}>
      <div className="flex items-center gap-1.5 shrink-0">
        {dynamicChips.map((chip) => {
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
