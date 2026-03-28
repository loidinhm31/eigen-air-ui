import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@nonclaw-ui/shared/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border border-border bg-card text-foreground",
        primary: "border border-primary/40 bg-primary/20 text-primary",
        success: "border border-green-500/40 bg-green-500/20 text-green-400",
        destructive: "border border-destructive/40 bg-destructive/20 text-destructive",
        warning: "border border-yellow-500/40 bg-yellow-500/20 text-yellow-400",
        outline: "border border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.memo(function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
});
Badge.displayName = "Badge";

export { badgeVariants };
