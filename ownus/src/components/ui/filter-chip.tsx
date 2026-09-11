"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  value: string;
  onRemove: (value: string) => void;
}

export function FilterChip({
  label,
  value,
  onRemove,
  className,
  ...props
}: FilterChipProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
        className
      )}
      onClick={() => onRemove(value)}
      {...props}
    >
      <span>{label}</span>
      <X
        className="h-3 w-3 opacity-70 hover:opacity-100"
        aria-hidden="true"
      />
      <span className="sr-only">Remove {label} filter</span>
    </button>
  );
}
