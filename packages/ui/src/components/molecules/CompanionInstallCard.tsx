import * as React from "react";
import { Download, Info, Laptop } from "lucide-react";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { cn } from "@eigen-air-ui/shared/utils";

import {
  COMPANION_PLATFORMS,
  type CompanionPlatformId,
  type PlatformConfig,
} from "./companion-platforms.js";

export interface CompanionInstallCardProps {
  readonly downloadUrls?: Partial<Record<CompanionPlatformId, string>>;
  readonly onDownload?: (platformId: CompanionPlatformId) => void;
  readonly className?: string;
}

export function CompanionInstallCard({
  downloadUrls = {},
  onDownload,
  className,
}: CompanionInstallCardProps): React.JSX.Element {
  return (
    <Card className={cn("border-border/70 bg-card text-card-foreground shadow-sm", className)}>
      <CardHeader className="space-y-1.5 pb-3">
        <div className="flex items-center gap-2">
          <Laptop className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-semibold">Install Companion Daemon</CardTitle>
          <Badge variant="outline" className="text-[10px] font-medium">Native Worker</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Portable client inference runs models and local acceleration directly on your host machine.
          The web browser does not execute native model weights or in-browser WebGPU.
        </p>
      </CardHeader>

      <CardContent className="space-y-4 text-xs">
        {/* Platform Downloads */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">Download for Your Platform</span>
            <span className="text-[11px] text-muted-foreground">Binary ~30–50 MB (excludes model weights)</span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {COMPANION_PLATFORMS.map((platform: PlatformConfig) => {
              const url = downloadUrls[platform.id];
              return (
                <div
                  key={platform.id}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-foreground">{platform.label}</div>
                    <div className="text-[11px] text-muted-foreground">{platform.arch}</div>
                  </div>

                  {url ? (
                    <a
                      href={url}
                      download
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  ) : onDownload ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2.5 text-xs"
                      onClick={() => onDownload(platform.id)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Available Soon
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step-by-Step Instructions */}
        <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
          <div className="font-semibold text-foreground">Setup Instructions</div>
          <ol className="space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">1</span>
              <span><strong>Download &amp; Run:</strong> Launch the native companion daemon on your local computer.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">2</span>
              <span><strong>Choose Storage:</strong> Select a local folder for model weights and cache directories.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">3</span>
              <span><strong>Copy Pairing Code:</strong> Note the 6-character code presented by the companion console.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">4</span>
              <span><strong>Approve in Browser:</strong> Enter the code in the pairing section below to link your device.</span>
            </li>
          </ol>
        </div>

        {/* Browser Close Behavior Notice */}
        <div className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/20 p-2.5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed">
            <strong>Tab Closure Isolation:</strong> Closing or refreshing this browser tab does not terminate the running
            companion daemon process. Ongoing downloads and device execution tasks remain running on your local machine.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
