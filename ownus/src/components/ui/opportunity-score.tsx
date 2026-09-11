import * as React from "react";
import { cn, getOpportunityColor, getOpportunityBg } from "@/lib/utils";

export interface OpportunityScoreProps extends React.HTMLAttributes<HTMLDivElement> {
  score: number;
  size?: "sm" | "md" | "lg";
  showNumber?: boolean;
}

export function OpportunityScore({
  score,
  size = "md",
  showNumber = true,
  className,
  ...props
}: OpportunityScoreProps) {
  const colorClass = getOpportunityColor(score);
  const bgClass = getOpportunityBg(score);

  const sizeClasses = {
    sm: "h-1.5 w-12",
    md: "h-2 w-16",
    lg: "h-2.5 w-24",
  };

  const textClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <div className={cn("overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/50 dark:border-zinc-700/50", sizeClasses[size])}>
        <div
          className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100 transition-all"
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
        />
      </div>
      {showNumber && (
        <span className={cn("font-bold font-mono text-zinc-900 dark:text-zinc-100", textClasses[size])}>
          {score}
        </span>
      )}
    </div>
  );
}
