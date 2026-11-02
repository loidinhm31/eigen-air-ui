import * as React from "react";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Download,
  Info,
  Laptop,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { cn } from "@eigen-air-ui/shared/utils";
import {
  COMPANION_PLATFORMS,
  type CompanionPlatformId,
  type PlatformConfig,
} from "./companion-platforms.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { getInferenceService } from "../../adapters/factory/ServiceFactory.js";

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
  const [selectedPlatform, setSelectedPlatform] =
    React.useState<CompanionPlatformId>("linux-x86_64");
  const [hostLabel, setHostLabel] = React.useState<string>("Local Companion");
  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [downloading, setDownloading] = React.useState<boolean>(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [downloadedFilename, setDownloadedFilename] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<boolean>(false);

  const activeInstallationId = useInferenceStore((s) => s.activeInstallationId);
  const setActiveInstallationId = useInferenceStore((s) => s.setActiveInstallationId);
  const createInstallation = useInferenceStore((s) => s.createInstallation);
  const fetchInstallation = useInferenceStore((s) => s.fetchInstallation);
  const installations = useInferenceStore((s) => s.installations);
  const hosts = useInferenceStore((s) => s.hosts);

  const currentInstallation = activeInstallationId
    ? installations[activeInstallationId]
    : null;

  const currentPlatformConfig =
    COMPANION_PLATFORMS.find((p) => p.id === selectedPlatform) ??
    COMPANION_PLATFORMS[0];

  // Poll installation status while waiting
  React.useEffect(() => {
    if (!activeInstallationId) return;

    fetchInstallation(activeInstallationId);
    const interval = setInterval(() => {
      fetchInstallation(activeInstallationId);
    }, 3000);

    return () => clearInterval(interval);
  }, [activeInstallationId, fetchInstallation]);

  const handleDownload = async (platformId: CompanionPlatformId) => {
    if (onDownload) {
      onDownload(platformId);
      return;
    }

    if (!currentPlatformConfig.downloadable) {
      setDownloadError(`Installer is not available for ${currentPlatformConfig.label}`);
      return;
    }

    setDownloading(true);
    setDownloadError(null);
    const startAccessKey = useInferenceStore.getState().accessKey;

    try {
      let instId = activeInstallationId;
      if (!instId) {
        const desc = await createInstallation({
          platform: platformId,
          label: hostLabel.trim() || "Local Companion",
        });
        instId = desc.installation_id;
      }

      const service = getInferenceService();
      const result = await service.downloadInstallationScript(instId);

      // Final access epoch and unmount fence immediately prior to object URL creation
      if (!isMountedRef.current) return;
      if (useInferenceStore.getState().accessKey !== startAccessKey) {
        throw new Error("Script download discarded due to access rotation before saving");
      }

      setDownloadedFilename(result.filename);

      // Trigger browser download via transient object URL and revoke
      const objectUrl = URL.createObjectURL(result.blob);
      try {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = result.filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Script download failed";
      setDownloadError(msg);
    } finally {
      if (isMountedRef.current) {
        setDownloading(false);
      }
    }
  };

  const handleNewInstallation = () => {
    setActiveInstallationId(null);
    setDownloadedFilename(null);
    setDownloadError(null);
  };

  const executionCmd = downloadedFilename
    ? currentPlatformConfig.executionCommand(downloadedFilename)
    : currentPlatformConfig.executionCommand(
        currentPlatformConfig.installerType === "powershell"
          ? "install-eigen-air.ps1"
          : "install-eigen-air.sh"
      );

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(executionCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  // Correlated hosts registered under active installation or matching correlated host_id
  const correlatedHosts = Object.values(hosts).filter(
    (h) =>
      h.installation_id === activeInstallationId ||
      Boolean(currentInstallation?.host_id && h.host_id === currentInstallation.host_id)
  );

  // Authoritative connectivity: scalar disconnect takes precedence over stale host map
  const isScalarDisconnected = currentInstallation !== null && currentInstallation?.connected === false;
  const isConnected =
    !isScalarDisconnected &&
    (Boolean(currentInstallation?.connected) ||
      correlatedHosts.some((h) => h.is_connected && h.lease_valid !== false));
  const isEnrolled =
    Boolean(currentInstallation?.enrolled) ||
    correlatedHosts.length > 0;
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
        {/* Platform Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">1. Select Target Host Platform</span>
            <span className="text-[11px] text-muted-foreground">Single-script installation</span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {COMPANION_PLATFORMS.map((platform: PlatformConfig) => {
              const isSelected = selectedPlatform === platform.id;
              const hasExternalUrl = Boolean(downloadUrls[platform.id]);

              return (
                <button
                  type="button"
                  key={platform.id}
                  onClick={() => setSelectedPlatform(platform.id)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isSelected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-medium text-foreground">{platform.label}</span>
                    {platform.qualified ? (
                      <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-400">
                        Qualified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">
                        Unqualified
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{platform.os} ({platform.arch})</div>
                  <div className="text-[10px] text-muted-foreground/80">{platform.notes}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Host Label Field (only when not yet generated) */}
        {!activeInstallationId && (
          <div className="space-y-1">
            <label htmlFor="companion-host-label" className="text-[11px] font-medium text-foreground">
              Host Machine Label (Optional)
            </label>
            <input
              id="companion-host-label"
              type="text"
              value={hostLabel}
              onChange={(e) => setHostLabel(e.target.value)}
              placeholder="e.g. Workstation 780M, Desktop Linux"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        )}

        {/* Generate / Download Action */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => handleDownload(selectedPlatform)}
            disabled={downloading || !currentPlatformConfig.downloadable}
            className="gap-1.5 h-8 text-xs font-medium"
          >
            {downloading ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Preparing Installer...
              </>
            ) : !currentPlatformConfig.downloadable ? (
              <>
                <Download className="h-3.5 w-3.5" />
                Installer Not Available
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                {activeInstallationId ? "Download Script Again" : "Download Pre-filled Installer"}
              </>
            )}
          </Button>

          {activeInstallationId && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleNewInstallation}
              className="h-8 text-xs text-muted-foreground"
            >
              New Installation
            </Button>
          )}

          {activeInstallationId && (
            <span className="font-mono text-[10px] text-muted-foreground">
              ID: {activeInstallationId.slice(0, 16)}...
            </span>
          )}
        </div>

        {downloadError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{downloadError}</span>
          </div>
        )}

        {/* 1-Command Execution View */}
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">2. Run on Target Machine</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[10px]"
              onClick={handleCopyCommand}
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Execute the downloaded installer in your terminal on the target machine. No tokens or manual configuration needed:
          </p>
          <div className="flex items-center justify-between rounded bg-muted/80 p-2 font-mono text-[11px] select-all overflow-x-auto text-foreground">
            <code>{executionCmd}</code>
          </div>
        </div>

        {/* Installation Observation Status */}
        {activeInstallationId && (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/50 p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">3. Installation Progress &amp; Connection</span>
              {isConnected ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
                  Connected ({correlatedHosts.length > 0 ? correlatedHosts.filter((h) => h.is_connected).length : 1})
                </Badge>
              ) : isEnrolled ? (
                <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                  Enrolled (Offline)
                </Badge>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                  Waiting for script execution...
                </div>
              )}
            </div>
            {correlatedHosts.length > 0 ? (
              <div className="space-y-1.5">
                {correlatedHosts.map((h) => (
                  <div
                    key={h.host_id}
                    className="flex items-center justify-between rounded border border-border/40 bg-muted/30 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle className={`h-3.5 w-3.5 ${h.is_connected ? "text-emerald-400" : "text-amber-400"}`} />
                      <span className="font-medium text-foreground">{h.label || h.host_id}</span>
                      <span className="text-[10px] text-muted-foreground">({h.platform})</span>
                    </div>
                    <Badge variant={h.current_binding?.state === "bound" ? "default" : "outline"} className="text-[10px]">
                      {h.current_binding?.state === "bound"
                        ? `Bound: ${h.current_binding.pool_id}`
                        : !isScalarDisconnected && h.is_connected
                        ? "Connected (Unbound)"
                        : "Enrolled (Offline)"}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : currentInstallation?.host_id ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between rounded border border-border/40 bg-muted/30 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle className={`h-3.5 w-3.5 ${currentInstallation.connected ? "text-emerald-400" : "text-amber-400"}`} />
                    <span className="font-medium text-foreground">{currentInstallation.label || currentInstallation.host_id}</span>
                    <span className="text-[10px] text-muted-foreground">({currentInstallation.platform})</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {currentInstallation.connected ? "Connected (Resolving Binding...)" : "Enrolled (Offline)"}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Run the command on your target host. Once the script connects to the gateway, this view will update automatically.
              </p>
            )}
          </div>
        )}

        {/* Security / Prototype Notice */}
        <div className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/20 p-2.5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-1 text-[11px] leading-relaxed">
            <p>
              <strong>Security Notice:</strong> The downloaded installer script contains the deployment&apos;s shared credential.
              Store or run it only on trusted machines, delete downloaded copies after installation, and avoid sharing terminal recordings.
            </p>
            <p>
              <strong>Tab Closure Isolation:</strong> Closing or refreshing this browser tab does not terminate the running
              companion daemon process.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
