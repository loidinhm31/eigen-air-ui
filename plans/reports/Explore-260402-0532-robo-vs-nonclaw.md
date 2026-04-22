# Exploration Report: robo-control-app vs nonclaw-ui

## Overview

Compared two embeddable React applications to understand their connection/auto-connect mechanisms and CSS loading strategies:
- **robo-control-app**: Socket.IO-based rover fleet control UI (manual connect, fixed backoff)
- **nonclaw-ui**: HTTP + WebSocket daemon UI (auto-connect, exponential backoff)

## 1. robo-control-app: Socket.IO Manual Connection

### Entry Point
- **apps/web/src/main.tsx**: Imports `@robo-fleet/ui/styles` → resolved via Vite alias to `../../packages/ui/src/styles/globals.css`
- **apps/web/vite.config.ts**: Defines alias and applies `tailwindcss()` plugin

### Socket.IO Connection Flow (RoboRoverControl.tsx:196–310)

**Manual Socket Creation:**
```typescript
const socket = io(serverUrl, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
  auth: connectAuth,
});
```

**Connection Characteristics:**
- **Manual trigger**: No auto-connect; user must call `connect()` via UI button
- **Retry strategy**: Fixed 1000ms delay, max 5 attempts (no exponential backoff)
- **Transport fallback**: WebSocket → polling if WS unavailable
- **Auth flow**: 
  - Initial: username/password or cached JWT token from sessionStorage
  - Server emits `auth_token` event → calculates refresh schedule from JWT payload
  - Refresh occurs 5 minutes before expiry via `auth_refresh` event
  - Error handling: `auth_error` event with reason codes (invalid_credentials, token_expired, rate_limited, idle_timeout)

**Event Handlers:**
- Connection: `connect` (updates ID), `disconnect` (clears state), `connect_error`
- Domain: `command_ack`, `servo_telemetry`, `transcription`, `performance_metrics`, `fleet_status`
- No automatic reconnection after disconnect; user action required

### ServiceFactory Alternative (Unused by Main Component)
- **Location**: packages/ui/src/services/SocketService.ts
- Static facade for `getSocketService()` (not used by RoboRoverControl directly)
- Used by `useConnection` hook for service-based DI pattern
- Requires explicit initialization by RoboControlApp embed component

---

## 2. nonclaw-ui: Auto-Connect with Exponential Backoff

### Entry Point
- **apps/web/src/main.tsx**: Imports `@nonclaw-ui/ui/styles` directly via package.json exports (no Vite alias)
- **apps/web/src/App.tsx**: `useEffect` with automatic connection logic on mount

### Connection Flow (App.tsx:13–57)

**Dual-Protocol Auto-Connect:**
```typescript
for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
  if (attempt > 0) {
    await backoff(RETRY_DELAYS_MS[attempt - 1]);  // 1s, 2s, 4s, 8s
  }
  setStatus("connecting");
  try {
    const health = await getConfigService().health();  // HTTP healthcheck
    setStatus("connected", health.version);
    
    try {
      const conn = await getChatService().connect();  // WebSocket connect
      setSessionId(conn.session_id);
    } catch (e) {
      console.warn("[App] WS connect failed:", e);
      // WS failure non-fatal; HTTP enough
    }
    return;  // Stop retrying on success
  } catch (e) {
    if (isLastAttempt) setStatus("disconnected");
  }
}
```

**Retry Strategy:**
- **Primary**: HTTP health check (RESTful)
- **Secondary**: WebSocket (optional, non-blocking)
- **Backoff**: Exponential [1s, 2s, 4s, 8s] = 5 total attempts
- **Cancellation**: Micro-polls during sleep (100ms intervals) to unblock on cleanup

### WebSocket Client (Native WebSocket, Not Socket.IO)
**Location**: packages/ui/src/adapters/ws/WsClient.ts

**Internal Reconnect Logic** (separate from App.tsx retry loop):
```typescript
private handleClose() {
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;
    setTimeout(() => {
      this.connect()
        .then(() => onReconnectCallback?.())
        .catch(() => {});
    }, delay);
  }
}
```

**Two Distinct Reconnect Mechanisms:**
1. **App.tsx**: Initial connection retry (HTTP-first, exponential backoff)
2. **WsClient**: Socket reconnection (automatic when established connection closes, also exponential)

---

## 3. CSS Handling & Standalone Mode Issue

### robo-control-app CSS Loading

**Globals.css Structure** (packages/ui/src/styles/globals.css):
```css
@import './fonts.css';
@import 'tailwindcss';

@source "../**/*.{ts,tsx}";  /* Tailwind content scanning */

@theme {
  /* Design tokens: --color-*, --font-*, --radius-*, animations */
}

@layer base {
  body { /* Wrapped in @layer to prevent leak to glean-oak-app */ }
}
```

**Import Chain (Problematic):**
1. `apps/web/src/main.tsx`: `import "@robo-fleet/ui/styles"`
2. Vite alias: `@robo-fleet/ui/styles` → `../../packages/ui/src/styles/globals.css`
3. `apps/web/vite.config.ts` explicitly resolves alias + applies `tailwindcss()` plugin
4. Both app-level AND package-level `tailwindcss()` plugins active during dev

**Standalone Mode Issue:**
- Vite alias resolution may fail or become stale in dev mode
- Two competing `tailwindcss()` plugins can cause race conditions
- CSS injection conditional on successful alias; if alias fails, styles are missing
- @tailwindcss/vite plugin registers CSS at document level, but only if import path resolves

**Why Embedded Mode Works:**
- glean-oak-app uses Shadow DOM isolation with regex replacements (reference: FinCatchEmbed.tsx pattern in CLAUDE.md)
- CSS scoped to Shadow DOM; element selectors in `@layer base` don't leak to light DOM
- CSS loads reliably because glean-oak-app handles import

### nonclaw-ui CSS Loading

**Globals.css Structure** (similar, but simpler):
```css
@import "tailwindcss";

@theme { /* Design tokens */ }

body { /* No @layer protection; app not documented as embeddable */ }
```

**Import Chain (Reliable):**
1. `apps/web/src/main.tsx`: `import "@nonclaw-ui/ui/styles"`
2. Package.json export: `"./styles": "./src/styles/globals.css"`
3. No Vite alias; direct module resolution
4. `apps/web/vite.config.ts` applies `tailwindcss()` plugin (single entry point)

**Why Standalone CSS Works:**
- Direct import path shorter, less prone to resolution failures
- No alias chain; straight module → export → CSS file
- Single clear entry point for `@tailwindcss/vite` plugin
- CSS reliably injected on initial page load

**Note**: nonclaw-ui does NOT have a root `tailwind.config.ts`; Tailwind v4 must rely on `@source` or default content scanning.

---

## 4. Comparative Summary

| Aspect | robo-control-app | nonclaw-ui |
|--------|------------------|-----------|
| **Connection Type** | Socket.IO | Native WebSocket |
| **Auto-Connect** | Manual (user clicks "Connect") | Automatic (useEffect on mount) |
| **Initial Retry** | Fixed 1000ms delay, 5 attempts | Exponential 1s→2s→4s→8s, 5 attempts |
| **Primary Protocol** | WebSocket (polling fallback) | HTTP healthcheck (WS optional) |
| **Auth Mechanism** | Username/password → JWT token + refresh scheduling | Service factory adapters (HTTP + WS) |
| **Reconnect (on close)** | Manual user action | Socket.IO-style auto-reconnect (exponential backoff) |
| **CSS Import Style** | Vite alias (`@robo-fleet/ui/styles`) | Direct package export (`@nonclaw-ui/ui/styles`) |
| **CSS Scanning** | `@source` directive in CSS | Tailwind content config (if defined) |
| **Element Selector Protection** | `@layer base` for glean-oak-app compatibility | None (app not embeddable) |

---

## 5. CSS Differences Explaining Standalone Mode Issue

**robo-control-app Standalone Failure:**
1. Vite alias: `@robo-fleet/ui/styles` → vite.config.ts path.resolve
2. Path resolves to `../../packages/ui/src/styles/globals.css`
3. In dev mode, Vite may cache stale alias or lose resolution context
4. `tailwindcss()` plugin relies on successful file import; if alias fails, no CSS
5. Result: Styles missing in dev server, app loads unstyled

**nonclaw-ui Standalone Success:**
1. Direct import: `@nonclaw-ui/ui/styles` → package.json export
2. Module resolver finds `./src/styles/globals.css` directly
3. No alias indirection; simpler, more predictable resolution
4. `tailwindcss()` plugin processes single, clear entry point
5. CSS injected reliably; app loads with styles

---

## 6. Unresolved Questions

- What is the exact Vite version and behavior in robo-control-app's `tailwindcss()` plugin configuration?
- Does robo-control-app have a root `tailwind.config.ts`, or does content scanning rely solely on `@source` in CSS?
- Is the alias chain in robo-control-app's vite.config.ts intended, or an artifact of early monorepo setup?
- What is `MAX_RECONNECT_ATTEMPTS` and `RECONNECT_DELAY_MS` in nonclaw-ui's shared constants?

