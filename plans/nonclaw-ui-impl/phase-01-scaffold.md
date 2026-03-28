# Phase 1: Monorepo Scaffold

> Parent: [plan.md](./plan.md) | Dependencies: none | Blocks: all phases
> Target: `/home/loidinh/ws/sharing/qm-sync/embed-app/nonclaw-ui/`
> Reference: fin-catch, money-insight (same `qm-sync/embed-app/` directory)

## Overview

| Field | Value |
|-------|-------|
| Date | 2026-03-28 |
| Priority | P1 — blocks all other phases |
| Effort | ~2h |
| Implementation | done |
| Review | done |
| Completed | 2026-03-28 |

Bootstrap the nonclaw-ui Turborepo monorepo: pnpm workspaces, shared TypeScript + ESLint configs, Prettier, CLAUDE.md, and directory stubs for all packages. After this phase `pnpm install` and `pnpm build` run without errors.

## Key Insights

- fin-catch uses `tabWidth: 4` / `printWidth: 120`; nonclaw-ui uses `tabWidth: 2` / `printWidth: 100` — intentional deviation.
- `eslint-config` package uses `dependencies` (not `devDependencies`) so plugins are available to consuming packages.
- No `pnpm-lock.yaml` in `.gitignore` — it should be committed once packages stabilize after Phase 2.
- Tailwind prettier plugin is safe to add now; it no-ops gracefully when no CSS config exists yet.

## Requirements

1. Root `package.json` — name `nonclaw-ui`, `packageManager: pnpm@9.1.0`, workspace scripts, devDeps
2. `pnpm-workspace.yaml` — `apps/*` + `packages/*`
3. `turbo.json` — build, dev (cache:false/persistent:true), lint, type-check, clean
4. `.gitignore`, `.prettierrc`, `.prettierignore`
5. `CLAUDE.md` — project overview + build commands
6. `packages/tsconfig/` — base.json, react-library.json, vite.json
7. `packages/eslint-config/` — base.js, react-internal.js (flat config)
8. Directory stubs (`apps/web/`, `apps/native/`, `packages/ui/`, `packages/shared/`)
9. `git init` + initial commit
10. `pnpm install` verifies clean

## Architecture

```
nonclaw-ui/
├── apps/
│   ├── web/.gitkeep               # Stub — Phase 5
│   └── native/.gitkeep           # Stub — Phase 6
├── packages/
│   ├── tsconfig/                  # @nonclaw-ui/tsconfig
│   │   ├── package.json
│   │   ├── base.json              # ES2022, bundler, strict
│   │   ├── react-library.json     # extends base + DOM + JSX, noEmit:false
│   │   └── vite.json              # extends base + DOM + JSX + vite/client
│   ├── eslint-config/             # @nonclaw-ui/eslint-config
│   │   ├── package.json
│   │   ├── base.js                # js + tseslint + prettier + turbo
│   │   └── react-internal.js      # extends base + react + hooks + refresh
│   ├── ui/.gitkeep               # Stub — Phase 3
│   └── shared/.gitkeep           # Stub — Phase 2
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── .gitignore
├── .prettierrc
├── .prettierignore
└── CLAUDE.md
```

## Related Code Files

- `/home/loidinh/ws/sharing/qm-sync/embed-app/fin-catch/package.json` — root scripts/devDeps pattern
- `/home/loidinh/ws/sharing/qm-sync/embed-app/fin-catch/packages/tsconfig/` — TS config pattern
- `/home/loidinh/ws/sharing/qm-sync/embed-app/fin-catch/packages/eslint-config/` — ESLint flat config pattern
- `/home/loidinh/ws/sharing/qm-sync/.claude/skills/turborepo-tauri-react/references/root-configs.md`
- `/home/loidinh/ws/sharing/qm-sync/.claude/skills/turborepo-tauri-react/references/tsconfig-package.md`
- `/home/loidinh/ws/sharing/qm-sync/.claude/skills/turborepo-tauri-react/references/eslint-package.md`

## Implementation Steps

### 1. Create directories

```bash
cd /home/loidinh/ws/sharing/qm-sync/embed-app/nonclaw-ui
mkdir -p apps/web apps/native packages/tsconfig packages/eslint-config packages/ui packages/shared
```

### 2. Root files

**`package.json`**
```json
{
  "name": "nonclaw-ui",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "dev:web": "turbo run dev --filter=@nonclaw-ui/web",
    "dev:tauri": "turbo run dev --filter=@nonclaw-ui/native",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "format": "prettier --write \"**/*.{ts,tsx,md,json}\"",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "clean": "turbo run clean"
  },
  "devDependencies": {
    "prettier": "^3.2.5",
    "prettier-plugin-tailwindcss": "^0.6.11",
    "turbo": "^2.5.4",
    "vitest": "^4.0.17"
  },
  "packageManager": "pnpm@9.1.0"
}
```

**`pnpm-workspace.yaml`**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**`turbo.json`**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "type-check": {
      "dependsOn": ["^type-check"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

**`.gitignore`**
```
node_modules
dist
.turbo
target
apps/native/src-tauri/target
apps/native/src-tauri/Cargo.lock
.env
.env.*
coverage
*.tsbuildinfo
.DS_Store
```

**`.prettierrc`**
```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

**`.prettierignore`**
```
node_modules
dist
.turbo
coverage
*.min.js
pnpm-lock.yaml
target
```

**`CLAUDE.md`**
```markdown
# CLAUDE.md

nonclaw-ui — Desktop (Tauri v2) + web (Vite SPA) UI for the nonclaw AI agent daemon.
Turborepo monorepo. Connects to `nonclaw daemon` at `localhost:18790` via REST + WebSocket.

## Build Commands

\`\`\`bash
pnpm install          # Install all deps
pnpm dev:web          # Web app dev server (port 25001)
pnpm dev:tauri        # Tauri desktop app dev
pnpm build            # Build all packages
pnpm lint             # ESLint check
pnpm type-check       # TypeScript check
pnpm test:run         # Run tests once
\`\`\`

## Architecture

- apps/web: Vite SPA
- apps/native: Tauri v2 shell (same React app, different entry)
- packages/ui: component library (atomic design) + ServiceFactory adapters
- packages/shared: domain types, constants
```

### 3. `packages/tsconfig/`

**`packages/tsconfig/package.json`**
```json
{
  "name": "@nonclaw-ui/tsconfig",
  "version": "0.0.0",
  "private": true,
  "files": ["base.json", "react-library.json", "vite.json"]
}
```

**`packages/tsconfig/base.json`**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Default",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true
  },
  "exclude": ["node_modules"]
}
```

**`packages/tsconfig/react-library.json`**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "React Library",
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": false
  }
}
```

**`packages/tsconfig/vite.json`**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Vite",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  }
}
```

### 4. `packages/eslint-config/`

**`packages/eslint-config/package.json`**
```json
{
  "name": "@nonclaw-ui/eslint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./base": "./base.js",
    "./react-internal": "./react-internal.js"
  },
  "dependencies": {
    "@eslint/js": "^9.27.0",
    "eslint": "^9.27.0",
    "eslint-config-prettier": "^10.1.5",
    "eslint-plugin-only-warn": "^1.1.0",
    "eslint-plugin-react": "^7.37.5",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.26",
    "eslint-plugin-turbo": "^2.5.4",
    "globals": "^15.15.0",
    "typescript-eslint": "^8.33.0"
  }
}
```

**`packages/eslint-config/base.js`**
```javascript
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

/** @type {import("eslint").Linter.Config[]} */
export const config = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: { turbo: turboPlugin },
    rules: { "turbo/no-undeclared-env-vars": "warn" },
  },
  { plugins: { onlyWarn } },
  { ignores: ["dist/**", "node_modules/**"] },
];
```

**`packages/eslint-config/react-internal.js`**
```javascript
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import { config as baseConfig } from "./base.js";

/** @type {import("eslint").Linter.Config[]} */
export const config = [
  ...baseConfig,
  pluginReact.configs.flat.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
      "react-refresh": pluginReactRefresh,
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
];
```

### 5. Stubs + git init

```bash
touch apps/web/.gitkeep apps/native/.gitkeep
git init
git add -A
git commit -m "feat: phase-01 scaffold Turborepo monorepo with shared configs"
```

### 6. Install and verify

```bash
pnpm install
pnpm build   # Should complete (no packages have build scripts yet)
```

## Todo

- [x]Create directory structure (apps/web, apps/native, packages/*)
- [x]Write root package.json, pnpm-workspace.yaml, turbo.json
- [x]Write .gitignore, .prettierrc, .prettierignore, CLAUDE.md
- [x]Write packages/tsconfig/ (4 files)
- [x]Write packages/eslint-config/ (3 files)
- [x]Add .gitkeep stubs for apps/ and packages/ui, packages/shared
- [x]git init + initial commit
- [x]pnpm install — verify zero errors
- [x]pnpm build — verify pipeline runs

## Success Criteria

- `pnpm install` completes with zero errors
- `pnpm build` runs Turborepo pipeline without errors
- `ls packages/` → tsconfig, eslint-config, ui (stub), shared (stub)
- `git log` shows initial commit

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| pnpm version mismatch | `packageManager: "pnpm@9.1.0"` + `corepack enable` |
| ESLint peer conflicts | Use `dependencies` (not `devDependencies`) in eslint-config |
| prettier-plugin-tailwindcss requires tailwind | Plugin no-ops gracefully until CSS added |

## Security Considerations

None — pure configuration files. `.gitignore` includes `.env*` to protect future secrets.

## Next Steps

Phase 2: Shared Package — domain types (ChatMessage, Memory, Tool, Skill, Session, Agent, Config), WS frame types, API error types, constants (DAEMON_URL, STORAGE_KEYS).
