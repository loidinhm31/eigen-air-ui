export type CompanionPlatformId =
  | "linux-x86_64"
  | "windows-x86_64"
  | "macos-arm64"
  | "macos-x64";

export interface PlatformConfig {
  readonly id: CompanionPlatformId;
  readonly label: string;
  readonly os: string;
  readonly arch: string;
  readonly installerType: "bash" | "powershell" | "unqualified";
  readonly downloadable: boolean;
  readonly qualified: boolean;
  readonly notes: string;
  readonly executionCommand: (filename: string) => string;
}

export const COMPANION_PLATFORMS: readonly PlatformConfig[] = [
  {
    id: "linux-x86_64",
    label: "Linux (Ubuntu / Fedora)",
    os: "Ubuntu 22.04+ / Fedora 39+",
    arch: "x86_64",
    installerType: "bash",
    downloadable: true,
    qualified: false,
    notes: "Installer downloadable; engine qualification pending M1-W gate",
    executionCommand: (filename: string) => `bash "./${filename}"`,
  },
  {
    id: "windows-x86_64",
    label: "Windows",
    os: "Windows 11 / Server 2022",
    arch: "x64",
    installerType: "powershell",
    downloadable: false,
    qualified: false,
    notes: "Unbuilt in release lockfile; companion installer disabled",
    executionCommand: (filename: string) => `powershell -ExecutionPolicy Bypass -File ".\\${filename}"`,
  },
  {
    id: "macos-arm64",
    label: "macOS (Apple Silicon)",
    os: "macOS 14+",
    arch: "ARM64",
    installerType: "unqualified",
    downloadable: false,
    qualified: false,
    notes: "Metal / MoltenVK retained declared / unqualified",
    executionCommand: (filename: string) => `bash "./${filename}"`,
  },
  {
    id: "macos-x64",
    label: "macOS (Intel)",
    os: "macOS 13+",
    arch: "x86_64",
    installerType: "unqualified",
    downloadable: false,
    qualified: false,
    notes: "Unqualified for managed companion gateway",
    executionCommand: (filename: string) => `bash "./${filename}"`,
  },
];
