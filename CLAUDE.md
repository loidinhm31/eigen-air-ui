# CLAUDE.md

nonclaw-ui — Desktop (Tauri v2) + web (Vite SPA) UI for the nonclaw AI agent daemon.
Turborepo monorepo. Connects to `nonclaw daemon` at `localhost:18790` via REST + WebSocket.

## Build Commands

```bash
pnpm install          # Install all deps
pnpm dev:web          # Web app dev server (port 25001)
pnpm dev:tauri        # Tauri desktop app dev
pnpm build            # Build all packages
pnpm lint             # ESLint check
pnpm type-check       # TypeScript check
pnpm test:run         # Run tests once
```

## Architecture

- apps/web: Vite SPA
- apps/native: Tauri v2 shell (same React app, different entry)
- packages/ui: component library (atomic design) + ServiceFactory adapters
- packages/shared: domain types, constants
