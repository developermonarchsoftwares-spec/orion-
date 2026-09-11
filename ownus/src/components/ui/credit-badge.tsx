import * as React from "react";
import { Zap } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

export interface CreditBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  credits: number;
  variant?: "sidebar" | "header" | "inline";
}

export function CreditBadge({
  credits,
  variant = "inline",
  className,
  ...props
}: CreditBadgeProps) {
  const isLow = credits < 100;
  
  const variants = {
    sidebar: "flex items-center justify-between w-full p-3 rounded-lg border border-border bg-surface",
    header: "flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface shadow-sm",
    inline: "inline-flex items-center gap-1.5",
  };

  const content = (
    <>
      <div className="flex items-center gap-1.5">
        <Zap
          className={cn(
            "fill-current text-zinc-900 dark:text-zinc-100",
            variant === "inline" ? "h-3.5 w-3.5" : "h-4 w-4"
          )}
        />
        <span
          className={cn(
            "font-semibold text-text-primary",
            variant === "inline" && "text-sm"
          )}
        >
          {formatNumber(credits)}
        </span>
      </div>
      {variant === "sidebar" && (
        <span className="text-xs text-text-secondary">Credits</span>
      )}
    </>
  );

  return (
    <div className={cn(variants[variant], className)} {...props}>
      {content}
    </div>
  );
}
