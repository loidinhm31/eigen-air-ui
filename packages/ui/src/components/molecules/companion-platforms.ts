export type CompanionPlatformId = "macos-arm64" | "macos-x64" | "linux-x64" | "windows-x64";

export interface PlatformConfig {
  readonly id: CompanionPlatformId;
  readonly label: string;
  readonly arch: string;
}

export const COMPANION_PLATFORMS: readonly PlatformConfig[] = [
  { id: "macos-arm64", label: "macOS", arch: "Apple Silicon" },
  { id: "macos-x64", label: "macOS", arch: "Intel x86_64" },
  { id: "linux-x64", label: "Linux", arch: "x86_64" },
  { id: "windows-x64", label: "Windows", arch: "x64" },
];
