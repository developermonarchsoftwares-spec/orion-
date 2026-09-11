import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  trend?: number;
  icon?: React.ReactNode;
  description?: string;
  valueFormatter?: (val: string | number) => string;
}

export function StatCard({
  title,
  value,
  trend,
  icon,
  description,
  valueFormatter,
  className,
  ...props
}: StatCardProps) {
  const isPositive = trend !== undefined && trend >= 0;
  const isNegative = trend !== undefined && trend < 0;
  
  const displayValue = valueFormatter ? valueFormatter(value) : (typeof value === "number" ? formatNumber(value) : value);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-white p-5 shadow-sm transition-all hover:shadow-md",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-secondary">{title}</h3>
        {icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-text-secondary">
            {icon}
          </div>
        )}
      </div>
      
      <div className="mt-4 flex items-baseline gap-2">
        <p className="text-2xl font-semibold text-text-primary">
          {displayValue}
        </p>
        
        {trend !== undefined && (
          <span
            className={cn(
              "flex items-center text-sm font-medium",
              isPositive ? "text-success" : "text-danger",
              trend === 0 && "text-text-secondary"
            )}
          >
            {isPositive ? (
              <ArrowUpRight className="mr-1 h-4 w-4" />
            ) : isNegative ? (
              <ArrowDownRight className="mr-1 h-4 w-4" />
            ) : null}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      
      {description && (
        <p className="mt-1 text-sm text-text-secondary">{description}</p>
      )}
    </div>
  );
}
