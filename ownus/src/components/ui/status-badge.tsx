import * as React from "react";
import { cn, getStatusColor } from "@/lib/utils";

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status: string;
  dotOnly?: boolean;
}

export function StatusBadge({
  status,
  dotOnly = false,
  className,
  ...props
}: StatusBadgeProps) {
  const colorClasses = getStatusColor(status);
  
  // Extract text color for the dot
  const textMatches = colorClasses.match(/text-([a-z]+-[0-9]+)/);
  const dotColor = textMatches ? `bg-${textMatches[1]}` : "bg-gray-500";

  const formattedStatus = status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ");

  if (dotOnly) {
    return (
      <div
        className={cn("h-2.5 w-2.5 rounded-full", dotColor, className)}
        title={formattedStatus}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        colorClasses,
        className
      )}
      {...props}
    >
      <div className="h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
      {formattedStatus}
    </div>
  );
}
