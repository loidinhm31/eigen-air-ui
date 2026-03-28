# Phase 6: Native App (Tauri v2)

> Parent: [plan.md](./plan.md) | Dependencies: Phase 5
> Reference: turborepo-tauri-react/references/native-app.md

## Overview

| Field | Value |
|-------|-------|
| Date | 2026-03-28 |
| Priority | P2 |
| Effort | ~1.5h |
| Implementation | pending |
| Review | pending |

Create `apps/native` — a Tauri v2 desktop shell around the same React app. The frontend is identical to `apps/web` (same packages/ui, same ServiceFactory, same BrowserRouter wrapper). The only Tauri-specific additions are: `src-tauri/` Rust crate (minimal, just plugin-opener), `tauri.conf.json`, and `capabilities/default.json`. Both web and native connect to the nonclaw daemon as a separate process — no Tauri IPC commands needed.

## Key Insights

- Tauri v2 is a webview shell; the React app communicates with nonclaw daemon via WebSocket and REST (HTTP) exactly like the web app. No Rust IPC commands (`#[tauri::command]`) are needed.
- `src-tauri/src/lib.rs` is ~5 lines — just initializes `tauri-plugin-opener` and runs the app.
- Vite dev server for Tauri uses port `1420` (Tauri convention) with `TAURI_DEV_HOST` env var support.
- `beforeDevCommand` in tauri.conf.json runs `pnpm dev` (Vite) before Tauri spawns the webview.
- The frontend's `apps/native/src/init.ts` is identical to `apps/web/src/init.ts` — same adapters, same daemon URL.
- macOS requires adding `http://localhost:18790` to CSP/permissions; set `"csp": null` in dev for simplicity (tighten before release).
- Window size: 1200×800, resizable, decorations enabled.

## Requirements

1. `apps/native/package.json` — `@nonclaw-ui/native`, Vite + Tauri deps
2. `apps/native/vite.config.ts` — same as web but port 1420, clearScreen:false, TAURI_DEV_HOST support
3. `apps/native/tsconfig.json` + `tsconfig.node.json`
4. `apps/native/index.html`
5. `apps/native/src/init.ts`, `src/main.tsx`, `src/App.tsx` (same as web)
6. `apps/native/src-tauri/Cargo.toml`
7. `apps/native/src-tauri/tauri.conf.json`
8. `apps/native/src-tauri/capabilities/default.json`
9. `apps/native/src-tauri/src/lib.rs` (minimal)
10. `apps/native/src-tauri/build.rs`

## Architecture

```
apps/native/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── eslint.config.js
├── index.html
├── src/
│   ├── init.ts          # Identical to apps/web/src/init.ts
│   ├── main.tsx         # Identical to apps/web/src/main.tsx
│   ├── App.tsx          # Identical to apps/web/src/App.tsx
│   └── vite-env.d.ts
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    ├── icons/           # (generate with tauri icon command later)
    └── src/
        └── lib.rs
```

## Implementation Steps

### 1. Frontend package config

**`apps/native/package.json`**
```json
{
  "name": "@nonclaw-ui/native",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "tauri": "tauri",
    "lint": "eslint src/",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@nonclaw-ui/shared": "workspace:*",
    "@nonclaw-ui/ui": "workspace:*",
    "@tauri-apps/api": "^2.5.0",
    "@tauri-apps/plugin-opener": "^2.3.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.5.3"
  },
  "devDependencies": {
    "@nonclaw-ui/eslint-config": "workspace:*",
    "@nonclaw-ui/tsconfig": "workspace:*",
    "@tailwindcss/vite": "^4.1.17",
    "@tauri-apps/cli": "^2.5.0",
    "@types/react": "^19.1.6",
    "@types/react-dom": "^19.1.5",
    "@vitejs/plugin-react": "^4.6.0",
    "tailwindcss": "^4.1.17",
    "typescript": "^5.8.3",
    "vite": "^7.0.4"
  }
}
```

### 2. Vite config (Tauri-specific)

**`apps/native/vite.config.ts`**
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST || "localhost";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { outDir: "dist", sourcemap: true },
});
```

### 3. TypeScript configs

Same structure as `apps/web` (tsconfig.json + tsconfig.node.json).

### 4. Frontend source files

`src/init.ts`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts` — **identical to apps/web** (copy verbatim). Both apps use the same `NonclawApp` embed + the same adapter initialization.

### 5. Rust crate

**`apps/native/src-tauri/Cargo.toml`**
```toml
[package]
name = "nonclaw-ui-app"
version = "0.1.0"
description = "nonclaw Desktop UI"
authors = []
edition = "2021"

[lib]
name = "nonclaw_ui_app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

**`apps/native/src-tauri/build.rs`**
```rust
fn main() {
    tauri_build::build()
}
```

**`apps/native/src-tauri/src/lib.rs`**
```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 6. Tauri configuration

**`apps/native/src-tauri/tauri.conf.json`**
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "nonclaw",
  "version": "0.1.0",
  "identifier": "io.nonclaw.ui",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "nonclaw",
        "width": 1200,
        "height": 800,
        "resizable": true,
        "fullscreen": false,
        "decorations": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "opener": {}
  }
}
```

**`apps/native/src-tauri/capabilities/default.json`**
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default"
  ]
}
```

### 7. Icons (placeholder)

Generate placeholder icons or copy from fin-catch/money-insight:
```bash
cd apps/native/src-tauri
mkdir -p icons
# Use tauri CLI to generate from a source PNG, or copy placeholder icons
```

### 8. Add `dev:tauri` to root turbo pipeline

The root `package.json` already has `"dev:tauri": "turbo run dev --filter=@nonclaw-ui/native"`. Tauri dev is run directly via `pnpm --filter @nonclaw-ui/native tauri dev` which handles Vite + Rust compilation.

### 9. Build and test

```bash
# Dev (requires Rust toolchain + Tauri CLI)
pnpm --filter @nonclaw-ui/native tauri dev

# Build release binary
pnpm --filter @nonclaw-ui/native tauri build
```

## Todo

- [ ] Write apps/native/package.json
- [ ] Write apps/native/vite.config.ts (port 1420, clearScreen:false, TAURI_DEV_HOST)
- [ ] Write tsconfig.json + tsconfig.node.json
- [ ] Write index.html
- [ ] Copy src/init.ts, src/main.tsx, src/App.tsx from apps/web (identical)
- [ ] Write src-tauri/Cargo.toml
- [ ] Write src-tauri/build.rs
- [ ] Write src-tauri/src/lib.rs (5 lines)
- [ ] Write src-tauri/tauri.conf.json
- [ ] Write src-tauri/capabilities/default.json
- [ ] Add placeholder icons
- [ ] `pnpm --filter @nonclaw-ui/native tauri dev` — desktop window opens
- [ ] Connection to nonclaw daemon verified in desktop window

## Success Criteria

- `pnpm --filter @nonclaw-ui/native tauri dev` opens a desktop window
- App renders identically to web version
- Daemon connection works inside Tauri webview
- `pnpm --filter @nonclaw-ui/native tauri build` produces a release binary
- Binary < 20MB (Tauri's bundled webview uses system WebKit/Edge, not Chromium)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Rust toolchain not installed | Document: `rustup install stable` prerequisite in CLAUDE.md |
| Tauri CLI version mismatch | Use `@tauri-apps/cli: "^2.5.0"` matching `tauri: "2"` in Cargo.toml |
| CSP blocks WebSocket to localhost | Set `"csp": null` in tauri.conf.json for dev; revisit for production |
| Icons missing → bundle fails | Generate with `cargo tauri icon ./icon.png` or use placeholder 32x32.png |
| CORS on localhost WebSocket | Tauri uses system WebView; WebSocket to localhost works without CORS headers |

## Security Considerations

- Tauri capability system: `capabilities/default.json` grants only `core:default` + `opener:default`. No file system or shell access from the webview — nonclaw daemon handles all file/shell operations via its own security policy.
- `csp: null` should be replaced with a strict CSP in production: `connect-src 'self' http://localhost:18790 ws://localhost:18790`.
- Tauri's IPC bridge is not used (no `invoke()` calls) — attack surface is minimal.

## Next Steps

All 6 phases complete. nonclaw-ui is production-ready. Future iterations:
- Phase 7: Session history persistence (store sessions in localStorage)
- Phase 8: Multiple daemon profiles (switch between different daemon URLs)
- Phase 9: Markdown rendering for assistant messages (react-markdown)
- Phase 10: Dark/light theme toggle + theme persistence
