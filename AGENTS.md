# AGENTS.md

This file provides guidance to AI coding agents and developers working with code in this repository.

Eigen Air UI is the standalone web and desktop frontend for the Eigen Air
daemon. It is a PNPM/Turborepo workspace with a Vite web app and a Tauri v2
desktop shell. The apps connect to the daemon over REST and WebSocket on
`localhost:18790`.

The shared embed component is `EigenAirApp`, exported from
`@eigen-air-ui/ui/embed`. Browser storage uses the `eigen-air-*` namespace,
and Tauri's product identifier is `io.eigen-air.ui`. Previous-brand browser
keys and desktop profile data are not automatically migrated.

## Workspace

- `apps/web`: Vite browser app.
- `apps/native`: Vite app packaged by Tauri v2.
- `packages/shared`: shared domain types, constants, and utilities.
- `packages/ui`: React components, stores, adapters, and embed entry.
- `packages/eslint-config`: shared ESLint configuration.
- `packages/tsconfig`: shared TypeScript configurations.

The root package is `eigen-air-ui`; internal workspace packages use
`@eigen-air-ui/*`. Keep package manifests, workspace references, Vite aliases,
ESLint imports, TypeScript extends, and source imports aligned. PNPM is pinned
to `9.1.0` in the root manifest.

The native Rust crate is `eigen-air-ui-app`, with library
`eigen_air_ui_app_lib`; the launcher calls that library.

## Commands

Run these from the frontend workspace root:

```bash
pnpm install --frozen-lockfile
pnpm dev:web
pnpm dev:tauri # native Vite dev task; does not launch the Tauri shell
pnpm --filter @eigen-air-ui/native tauri dev
pnpm build
pnpm lint
pnpm type-check
pnpm test:run
pnpm test:e2e
```

`pnpm test:run` runs the package Vitest suite. `pnpm test:e2e` runs Playwright
and needs its configured backend and browser prerequisites.

Set `EIGEN_AIR_DIR` to the backend checkout when it is outside Playwright's
discovery layout:

```bash
EIGEN_AIR_DIR=/path/to/eigen-air pnpm test:e2e
```
