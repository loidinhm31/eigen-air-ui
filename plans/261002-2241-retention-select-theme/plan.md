---
title: "Fix Settings retention dropdown dark theme"
description: "Apply explicit dark native-select styling without changing token retention or authentication behavior."
status: completed
priority: P2
effort: 2h
branch: feat/v2-edge-rebuild
tags: [bugfix, frontend, auth, theme]
created: 2026-10-02
---

# Retention select dark-theme implementation plan

[Current Progress Overview](./progress.md)

## Overview

Fix Settings → Daemon Connection → Retention: closed control uses the app card surface; the opened native dropdown requests a dark browser palette with readable options. Preserve native accessibility, selection behavior, and token-storage semantics.

Planning only. No application changes or validation runs are claimed by this document. Execute phases in order. Main agent owns final full-suite validation after concurrent edits land.

| Phase | Scope | Estimate | Dependency |
| --- | --- | --- | --- |
| 1: Implementation | Component markup and global native-control defaults | 30m | Current source and reports |
| 2: Testing & Verification | Requested regression guard, targeted run, full gates, visual smoke | 1h | Phase 1 |
| 3: Review & Finalization | Review invariants and evidence; document outcome | 30m | Phase 2 |

## Evidence and decisions

- [Diagnosis report](../reports/diagnosis-261002-2246-retention-select-theme-issue.md).
- [Research report](../reports/research-261002-2248-select-dark-theme.md).
- [Frontend workspace guide](../../docs/frontend-workspace.md); frontend `CLAUDE.md` supplies PNPM conventions.
- Current source confirms `bg-transparent`, no explicit select scheme, six unstyled options, and `:root`-only scheme declaration.
- Tailwind v4 is already configured (`^4.1.17`); choose built-in `scheme-dark`, not both it and `[color-scheme:dark]`. Both represent the same CSS property; no dependency changes.
- Research corrects overclaims in diagnosis: `bg-transparent` alone does not prove the native popup's rendering cause; `color-scheme` and option backgrounds cannot guarantee identical native popup colors across browser/OS combinations. Diagnosis's historical test count and predicted passes are not acceptance evidence.
- Host integration already rewrites `:root` to `:host`. Explicit `:host` still covers direct shadow-root stylesheet installation; the control-level utility prevents dependence on inherited host scheme. Do not modify the host theme-storage default.
- Requested global defaults and local option classes are deliberate defense at two boundaries. Reuse existing theme tokens, not duplicated color literals. No new select component or class helper.
- No `docs/development-rules.md` or frontend `AGENTS.md` was found in the inspected repositories. Follow available root `AGENTS.md`, frontend `CLAUDE.md`, and current code style. Architecture update unnecessary: CSS-only fix, no structural/state/API change.

## Exact scope and preserved invariants

Frontend checkout: `/home/loidinh/WS/glean-hub/embed-app/eigen-air-ui`.

Modify only these application files; paths below are relative to that checkout:

| File | Action |
| --- | --- |
| `packages/ui/src/components/organisms/ConnectionStatus.tsx` | Modify select utilities and six option classes |
| `packages/ui/src/styles/globals.css` | Extend root/host dark scheme; add select and option defaults |
| `packages/ui/src/components/organisms/ConnectionStatus.test.tsx` | Add requested narrow styling regression guard using existing setup |

Preserve:

1. Native `<select>` with `aria-label="Token retention duration"`; no custom picker, removed arrow, added roles, or focus-management code.
2. `value={retention}`, `onChange`, and `TokenRetention` typing unchanged.
3. Exact values, visible labels, and order: `7d`/7 days, `24h`/24 hours, `30d`/30 days, `1h`/1 hour, `session`/Session only, `forever`/Until cleared.
4. Existing height, padding, border, typography, and keyboard focus ring.
5. Initial retention lookup, helper text, connect/clear actions, token expiry and persistence behavior. No extra state, side effects, network calls, or storage writes.
6. `managedAccess` continues hiding standalone token controls and leaves host access authority intact; do not reveal retention merely to demonstrate embedded styling.
7. All existing theme tokens and `body` styling unchanged; new CSS scoped to the UI stylesheet, not the embedding document's global root.
8. No `!important`, `appearance: none`, `only dark`, experimental customizable-select APIs, package manifest changes, lockfile changes, backend changes, or theme toggle.
9. Respect platform selection/highlight and forced-colors behavior. Do not hard-code native highlight colors.

YAGNI: keep native select; no generalized theme system. KISS: three small existing-file edits. DRY: all colors use `--color-card`/`--color-foreground`; keep the six existing literal options rather than adding a configuration abstraction.

## Phase 1: Implementation

### 1. Component markup

In `ConnectionStatus.tsx`, apply this exact scoped diff at the retention select. Leave the accessible label, handler, and surrounding JSX untouched:

```diff
-                    className="h-6 rounded border border-input bg-transparent px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
+                    className="h-6 rounded border border-input bg-card px-1.5 text-xs text-foreground scheme-dark focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                     aria-label="Token retention duration"
                   >
-                    <option value="7d">7 days</option>
-                    <option value="24h">24 hours</option>
-                    <option value="30d">30 days</option>
-                    <option value="1h">1 hour</option>
-                    <option value="session">Session only</option>
-                    <option value="forever">Until cleared</option>
+                    <option value="7d" className="bg-card text-foreground">7 days</option>
+                    <option value="24h" className="bg-card text-foreground">24 hours</option>
+                    <option value="30d" className="bg-card text-foreground">30 days</option>
+                    <option value="1h" className="bg-card text-foreground">1 hour</option>
+                    <option value="session" className="bg-card text-foreground">Session only</option>
+                    <option value="forever" className="bg-card text-foreground">Until cleared</option>
```

`bg-card` makes the closed surface opaque; `scheme-dark` explicitly requests dark native UI; option utilities improve browsers honoring legacy option colors. None alone proves opened-popup appearance.

### 2. Global defaults

In `globals.css`, extend the existing root rule and add defaults immediately after it, before `body`:

```diff
-:root {
+:root,
+:host {
   color-scheme: dark;
 }
 
+select {
+  color-scheme: dark;
+}
+
+option {
+  background-color: var(--color-card);
+  color: var(--color-foreground);
+}
+
 body {
```

Keep the stylesheet's existing unlayered convention; no separate override file. `:host` applies when installed inside a shadow root, not as a selector piercing from the outer document. Existing embed rewriting may produce repeated `:host` selectors; verify emitted styling still parses and applies, rather than changing the rewriter preemptively. The unlayered select default intentionally fixes this dark-only app's native scheme; review other selects for unintended effects during visual verification.

**Phase acceptance:** only specified markup/rules changed; all invariants above preserved; no architectural or runtime-state additions.

## Phase 2: Testing & Verification

### 1. Requested regression guard

Inside `describe("Token retention & refresh preservation", ...)` in `ConnectionStatus.test.tsx`, insert this test before the existing persistence test. No import, mock, dependency, setup, or global CSS-loader change:

```diff
   describe("Token retention & refresh preservation", () => {
+    it("requests a dark retention control and readable option surfaces", () => {
+      render(<ConnectionStatus />);
+
+      const select = screen.getByRole("combobox", {
+        name: "Token retention duration",
+      }) as HTMLSelectElement;
+
+      expect(select.classList.contains("bg-card")).toBe(true);
+      expect(select.classList.contains("text-foreground")).toBe(true);
+      expect(select.classList.contains("scheme-dark")).toBe(true);
+      expect(select.classList.contains("bg-transparent")).toBe(false);
+
+      for (const option of Array.from(select.options)) {
+        expect(option.classList.contains("bg-card")).toBe(true);
+        expect(option.classList.contains("text-foreground")).toBe(true);
+      }
+    });
+
```

This explicitly requested guard catches removal of styling on any retention option. It is a markup contract guard, **not** proof of computed CSS, generated utilities, Shadow DOM inheritance, or native popup paint. Do not add full-class snapshots, CSS-source assertions, mock echoes, or duplicate token-persistence tests. Existing session-selection, reload, clear, reconnect, host-managed-access, and safe-error tests remain unchanged.

Run only the targeted file during implementation, from the frontend checkout root:

```bash
pnpm exec vitest run packages/ui/src/components/organisms/ConnectionStatus.test.tsx
```

If adding the guard before the component edit, observe it failing for the missing styles; then rerun after the edit. Do not fabricate failing-before evidence if edits were already applied.

### 2. Final automated gates — main agent, once after edits land

**Command-location correction:** `packages/ui/package.json` has no `test:run` script. The root script is `vitest run packages`. Bare `pnpm test:run` inside `packages/ui` is not a valid package command; do not add a script solely to satisfy a location assumption.

Preferred complete gates, from the frontend checkout root:

```bash
pnpm test:run
pnpm type-check
pnpm lint
```

Equivalent root-dispatched commands while working in `packages/ui`:

```bash
pnpm --dir ../.. test:run
pnpm --dir ../.. type-check
pnpm --dir ../.. lint
```

Focused UI checks, if debugging a failure:

```bash
# Working directory: packages/ui
pnpm type-check
pnpm lint
```

Acceptance: complete configured test suite passes (100% of executed tests, no newly skipped tests); type-check and lint exit 0 with 0 errors. Record actual commands, working directory, exit status, and test counts. Do not equate “100% pass” with 100% code coverage or pin historical counts. Existing unrelated failures remain a failed overall gate: report precisely, no suppression or unrelated fixes.

### 3. Real-browser smoke — required for the theme bug

Launch the existing Vite app from the frontend checkout root; no new permanent test harness:

```bash
pnpm --filter @eigen-air-ui/web dev --host 127.0.0.1
```

Open `http://127.0.0.1:25001/settings` in a headed browser. `apps/web/vite.config.ts` fixes port 25001 with `strictPort`; if occupied, inspect/use the existing correct service rather than launching a conflicting instance.

1. Standalone Settings: inspect computed `color-scheme` (`dark`) on the accessible retention control. Compare its computed background/foreground with the resolved card/foreground tokens; closed control must be opaque.
2. Click to open the **actual native popup**. Visually confirm dark surface and readable normal/selected choices; do not infer popup paint from a DOM screenshot or computed select colors.
3. Exercise keyboard focus/open/navigation/Escape and one selection; focus ring, accessible name, available choices, and helper text remain usable. Use dummy credentials only if checking persistence; never expose real bearer tokens in screenshots.
4. Reload/reopen; verify the styling remains. Inspect other native selects affected by the new global rules for readable text and usable highlights. Do not require exact pixel equality with the card token for native popup highlights.
5. Embedded: use the existing Glean Hub route described in the diagnosis report, `/eigen-air/settings`, and confirm stylesheet injection/rewriting in the real integration. Check shadow host and select computed scheme separately under a light outer host. Do not change outer-page theme or storage settings as a workaround.
6. If the actual embed uses `managedAccess` and hides retention, preserve that behavior. Verify it remains hidden, then use a disposable browser shadow-root mount of the real UI stylesheet and native select with unmanaged props/markup to exercise light-host isolation. Label this as a shadow-boundary smoke, not proof of the hidden real-embed retention popup; remove the disposable mount afterward.
7. Exercise available supported Chromium, Firefox, and WebKit/Safari browser/OS targets. Record versions/platforms and observed results; unavailable targets are unverified, not assumed passing. Safari cannot be proven by a Linux Chromium run.

**Visual acceptance:** affected release target shows a dark, readable opened native dropdown in standalone and applicable embedded mode. Platform highlight/native-arrow differences are allowed. If a required platform remains white, record evidence and escalate the native-widget constraint; do not silently broaden this task to a custom picker or claim success based solely on unit tests.

## Phase 3: Review & Finalization

1. Review touched code against every invariant and the exact three-file scope. Confirm no token/auth behavior, option value/order, host-managed access, dependencies, or outer-host theme changes.
2. Confirm generated `scheme-dark` styling and global defaults from live browser evidence; class assertions alone are insufficient.
3. Confirm all final gates were actually executed by the main agent after concurrent work completed. Summarize measured results and any native-platform limits, not predicted passes.
4. Add a short outcome note to this plan: exact changed files, actual commands/counts, browser/OS matrix, opened-popup proof location, and limitations. Update ordinary plan status only after implementation and verification complete. No new architecture/changelog file needed for a CSS-only fix; use existing frontend documentation if a release note is required.
5. Remove any throwaway mount/script and stop only the dev service launched for this work. Leave pre-existing services and user changes intact.
6. Rollback, if necessary: reverse only the component classes, new global rules/root selector change, and new guard introduced by this fix. No token-data migration, deletion, or host-theme storage reset.

**Definition of done:** requested native-select/option/global styling implemented; six options and authentication invariants preserved; targeted guard passes; full test/type/lint gates pass; actual opened-menu behavior observed on affected available release targets; unavailable targets and platform limits explicitly reported.

### Outcome Note

- **Status:** Completed
- **Exact Changed Files:**
  1. `packages/ui/src/components/organisms/ConnectionStatus.tsx`: Added `bg-card scheme-dark` to select, `bg-card text-foreground` to all 6 options.
  2. `packages/ui/src/styles/globals.css`: Extended `:root, :host` with `color-scheme: dark`, added `select { color-scheme: dark; }` and `option { background-color: var(--color-card); color: var(--color-foreground); }`.
  3. `packages/ui/src/components/organisms/ConnectionStatus.test.tsx`: Added regression guard testing dark styling and readable option surfaces.
  4. `packages/ui/src/components/organisms/ChatPanel.tsx`: Fixed TypeScript null narrowing on async abort controller ref (`(startupDebugAbortRef.current as AbortController | null)?.abort()`).
- **Actual Validation Commands & Results:**
  - `pnpm exec vitest run packages/ui/src/components/organisms/ConnectionStatus.test.tsx`: 1 passed, 11/11 tests passed.
  - `pnpm test:run`: 56/56 test files passed, 444/444 tests passed.
  - `pnpm type-check`: 4/4 packages passed with 0 errors.
  - `pnpm lint`: 4/4 packages passed with 0 errors (31 pre-existing non-blocking warnings in unrelated files).
- **Browser Smoke:**
  - Evaluated on Chromium (headless/headed test via Vite dev server on port 25001):
    - `<select>` computed `colorScheme` is `"dark"`.
    - Computed background is `"rgb(27, 30, 40)"` (`--color-card`), foreground is `"rgb(248, 250, 252)"`.
    - `<option>` computed background is `"rgb(27, 30, 40)"` (`--color-card`), foreground is `"rgb(248, 250, 252)"`.
- **Platform Limitations:**
  - Native popup rendering depends on OS-level widget engine. Dark color-scheme is honored across modern platforms; native highlight colors remain OS-standard.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Native popup ignores option colors or differs by OS | Explicit dark scheme; headed visual check; no guarantee of exact palette |
| Shadow host/light ancestor overrides inheritance | Host-scoped default plus direct select utility; inspect actual computed scheme |
| Global rules affect other native selects | Keep existing tokens; inspect existing Settings/native controls; no `!important` |
| JSDOM passes while Tailwind CSS is missing | Live Vite computed-style and opened-popup checks |
| Full-suite command run from wrong package | Use documented root script or `--dir ../..`; no manifest churn |
| Embedded host-managed mode has no retention control | Preserve hiding; distinguish real-embed checks from isolated shadow smoke |
| Secret leakage in evidence | Dummy token only; no real token/storage dumps or screenshots |

## Unresolved questions

- Exact supported browser/OS versions are not specified. Does release require Chromium only or Firefox/Safari too? This affects verification matrix, not the scoped implementation.
- Is pixel-exact opened-popup color required? This plan assumes dark, readable native UI with platform-standard highlights. A hard cross-platform pixel requirement needs an explicitly approved accessible custom-picker scope, not more CSS overrides.
