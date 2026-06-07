import * as React from "react";
import { cn } from "@nonclaw-ui/shared/utils";

export const NativeScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("min-h-0 overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));

NativeScrollArea.displayName = "NativeScrollArea";
