# Phase 5: Web App

> Parent: [plan.md](./plan.md) | Dependencies: Phase 4 | Blocks: Phase 6
> Reference: turborepo-tauri-react/references/web-app.md

## Overview

| Field | Value |
|-------|-------|
| Date | 2026-03-28 |
| Priority | P1 |
| Effort | ~1.5h |
| Implementation | done |
| Review | done |

Wire up `apps/web` — a Vite SPA that initializes all service adapters (using the daemon URL from `connectionStore`), wraps `NonclawApp` with `BrowserRouter`, and performs a health check on mount to set connection status. After this phase the web app runs with `pnpm dev:web` and connects to a live nonclaw daemon.

## Key Insights

- Adapter init happens in `src/init.ts` (not `App.tsx`) so it can be reused in the native app (Phase 6) by importing the same module.
- `BrowserRouter` is used in the web app; `NonclawApp` accepts `useRouter={false}` when Tauri app wraps its own BrowserRouter, or `useRouter={true}` with internal `MemoryRouter`. For web use `BrowserRouter` externally and pass `useRouter={false}`.
- Health check on boot: call `getConfigService().health()` → update `connectionStore.status`. Retry on failure with exponential backoff (simple `setTimeout`).
- Web app port: `25001` (250xx range, consistent with other glean-oak-sync embed apps).
- No env vars needed for v1 — daemon URL comes from `connectionStore` (localStorage with default).

## Requirements

1. `apps/web/package.json` — `@nonclaw-ui/web`, Vite scripts, React deps + ui/shared workspace deps
2. `apps/web/vite.config.ts` — React plugin + Tailwind v4 (`@tailwindcss/vite`), port 25001
3. `apps/web/tsconfig.json` + `tsconfig.node.json`
4. `apps/web/index.html`
5. `apps/web/src/init.ts` — creates and registers all adapters with ServiceFactory
6. `apps/web/src/main.tsx` — imports styles + init + renders App
7. `apps/web/src/App.tsx` — BrowserRouter + NonclawApp + connection health check on mount
8. `apps/web/eslint.config.js`

## Architecture

```
apps/web/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── eslint.config.js
├── index.html
└── src/
    ├── init.ts          # ServiceFactory initialization (adapter wiring)
    ├── main.tsx         # Entry: import styles + init + render
    ├── App.tsx          # BrowserRouter + NonclawApp + health check
    └── vite-env.d.ts
```

## Implementation Steps

### 1. Package config

**`apps/web/package.json`**
```json
{
  "name": "@nonclaw-ui/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@nonclaw-ui/shared": "workspace:*",
    "@nonclaw-ui/ui": "workspace:*",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.5.3"
  },
  "devDependencies": {
    "@nonclaw-ui/eslint-config": "workspace:*",
    "@nonclaw-ui/tsconfig": "workspace:*",
    "@tailwindcss/vite": "^4.1.17",
    "@types/react": "^19.1.6",
    "@types/react-dom": "^19.1.5",
    "@vitejs/plugin-react": "^4.6.0",
    "tailwindcss": "^4.1.17",
    "typescript": "^5.8.3",
    "vite": "^7.0.4"
  }
}
```

### 2. Vite config

**`apps/web/vite.config.ts`**
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 25001,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
```

### 3. TypeScript configs

**`apps/web/tsconfig.json`**
```json
{
  "extends": "@nonclaw-ui/tsconfig/vite.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**`apps/web/tsconfig.node.json`**
```json
{
  "extends": "@nonclaw-ui/tsconfig/base.json",
  "compilerOptions": { "composite": true, "types": ["node"] },
  "include": ["vite.config.ts"]
}
```

### 4. index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>nonclaw</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 5. Adapter initialization — `src/init.ts`

```typescript
import { useConnectionStore } from "@nonclaw-ui/ui/stores";
import {
  setChatService,
  setMemoryService,
  setToolService,
  setSkillService,
  setConfigService,
} from "@nonclaw-ui/ui/adapters/factory";
import { WsChatAdapter } from "@nonclaw-ui/ui/adapters/ws/WsChatAdapter";
import { HttpMemoryAdapter } from "@nonclaw-ui/ui/adapters/http/HttpMemoryAdapter";
import { HttpToolAdapter } from "@nonclaw-ui/ui/adapters/http/HttpToolAdapter";
import { HttpSkillAdapter } from "@nonclaw-ui/ui/adapters/http/HttpSkillAdapter";
import { HttpConfigAdapter } from "@nonclaw-ui/ui/adapters/http/HttpConfigAdapter";

export function initServices() {
  const daemonUrl = useConnectionStore.getState().url;
  const wsUrl = daemonUrl.replace(/^http/, "ws") + "/ws";

  setChatService(new WsChatAdapter(wsUrl));
  setMemoryService(new HttpMemoryAdapter(daemonUrl));
  setToolService(new HttpToolAdapter(daemonUrl));
  setSkillService(new HttpSkillAdapter(daemonUrl));
  setConfigService(new HttpConfigAdapter(daemonUrl));
}
```

### 6. main.tsx

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@nonclaw-ui/ui/styles";
import { initServices } from "./init";
import App from "./App";

initServices();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### 7. App.tsx

```typescript
import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { NonclawApp } from "@nonclaw-ui/ui/embed";
import { getConfigService } from "@nonclaw-ui/ui/adapters/factory";
import { useConnectionStore } from "@nonclaw-ui/ui/stores";

export default function App() {
  const setStatus = useConnectionStore((s) => s.setStatus);
  const setSessionId = useConnectionStore((s) => s.setSessionId);

  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      setStatus("connecting");
      try {
        const health = await getConfigService().health();
        if (!cancelled) setStatus("connected", health.version);
        // Attempt WS connect and store session_id
        try {
          const { getChatService } = await import("@nonclaw-ui/ui/adapters/factory");
          const conn = await getChatService().connect();
          if (!cancelled) setSessionId(conn.session_id);
        } catch { /* WS optional — REST still works */ }
      } catch {
        if (!cancelled) setStatus("disconnected");
      }
    }
    checkHealth();
    return () => { cancelled = true; };
  }, [setStatus, setSessionId]);

  return (
    <BrowserRouter>
      <NonclawApp useRouter={false} />
    </BrowserRouter>
  );
}
```

### 8. ESLint

**`apps/web/eslint.config.js`**
```javascript
import { config } from "@nonclaw-ui/eslint-config/react-internal";
export default config;
```

## Todo

- [x] Write package.json
- [x] Write vite.config.ts (port 25001, @tailwindcss/vite, no PostCSS)
- [x] Write tsconfig.json + tsconfig.node.json
- [x] Write index.html
- [x] Write src/init.ts (adapter wiring)
- [x] Write src/main.tsx (styles + init + render)
- [x] Write src/App.tsx (BrowserRouter + health check + NonclawApp)
- [x] Write src/vite-env.d.ts
- [x] Write eslint.config.js
- [x] `pnpm dev:web` → app loads at localhost:25001
- [x] With daemon running: StatusBadge shows "connected", Chat page functional

## Success Criteria

- `pnpm dev:web` starts without errors on port 25001
- App loads in browser — AppShell renders with sidebar
- With nonclaw daemon running: StatusBadge shows green "connected"
- Without daemon: StatusBadge shows red "disconnected"
- Chat page loads; sending a message works end-to-end with streaming

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| CORS blocking HTTP calls | nonclaw daemon axum server must have CORS headers for localhost:25001; verify in Phase 7 server config |
| WS URL construction from HTTP URL | `url.replace(/^http/, "ws")` handles both http → ws and https → wss |
| `initServices()` called before store hydrates | `useConnectionStore.getState()` is sync — Zustand reads localStorage synchronously on first access |

## Security Considerations

- Web app is localhost-only in dev. Production web deployment would need CORS configuration on the daemon.
- No API keys or tokens are hardcoded — all comes from daemon config.

## Next Steps

Phase 6: Native App (Tauri) — `apps/native` with Tauri v2 shell, same React app, minimal `src-tauri/src/lib.rs`, `tauri.conf.json`, and `capabilities/default.json`.
