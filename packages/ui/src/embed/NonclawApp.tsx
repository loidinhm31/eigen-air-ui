import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/templates/AppShell.js";
import { ChatPage } from "../components/pages/ChatPage.js";
import { MemoryPage } from "../components/pages/MemoryPage.js";
import { ToolsPage } from "../components/pages/ToolsPage.js";
import { SkillsPage } from "../components/pages/SkillsPage.js";
import { SessionsPage } from "../components/pages/SessionsPage.js";
import { SettingsPage } from "../components/pages/SettingsPage.js";
import { RunsPage } from "../components/pages/RunsPage.js";
import type { RunAccessContext } from "../adapters/http/HttpRunAdapter.js";
import { useConnectionStore } from "../stores/connectionStore.js";
import {
  getChatService,
  getConfigService,
  hasReinitFn,
  setServiceAccessContext,
} from "../adapters/factory/ServiceFactory.js";
import { initServicesForDaemonUrl } from "../adapters/factory/init-services.js";
import {
  BasePathContext,
  resolveBasePath,
} from "./base-path-navigation.js";

/** Backoff delays between successive health-check retries (4 gaps = 5 attempts). */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

interface NonclawAppProps {
  useRouter?: boolean;
  /** Route prefix used by parent router (e.g. "/nonclaw"). Routing is handled by React Router context — this prop is reserved for future use. */
  basePath?: string;
  embedded?: boolean;
  className?: string;
  /** Called when the app requests logout. Currently reserved — nonclaw daemon uses its own auth. */
  onLogoutRequest?: () => void;
  /** Ephemeral authenticated run access supplied by an embedding host. */
  runAccess?: RunAccessContext;
}

export function NonclawApp({
  useRouter = true,
  basePath,
  embedded: _embedded,
  className,
  onLogoutRequest: _onLogoutRequest,
  runAccess,
}: NonclawAppProps) {
  const daemonUrl = useConnectionStore((state) => state.url);
  const appLayerOwnsLifecycle = hasReinitFn();
  const resolvedBasePath = React.useMemo(() => resolveBasePath(basePath), [basePath]);

  React.useMemo(() => {
    setServiceAccessContext(runAccess);
    if (!appLayerOwnsLifecycle) {
      initServicesForDaemonUrl(daemonUrl);
    }
  }, [appLayerOwnsLifecycle, daemonUrl, runAccess]);

  React.useEffect(() => {
    // In apps/web (or any context where an app-layer init.ts has called
    // registerReinitFn), the app layer owns the full service lifecycle:
    //   • initial creation: apps/web/src/init.ts + main.tsx
    //   • URL changes:      ConnectionStatus.handleConnect() → reinitServices()
    //   • auto-connect:     App.tsx useEffect
    //
    // We MUST NOT touch services here in that case — doing so would disconnect
    // the WebSocket that ConnectionStatus just established.
    if (appLayerOwnsLifecycle) return;

    // Auto-connect: health check with exponential-backoff retries, then WS.
    const { setStatus, setSessionId } = useConnectionStore.getState();
    let cancelled = false;

    async function autoConnect() {
      for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
        if (cancelled) return;
        if (i > 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i - 1]));
          if (cancelled) return;
        }
        setStatus("connecting");
        try {
          await getConfigService().health();
          if (cancelled) return;
          const conn = await getChatService().connect();
          if (cancelled) return;
          setSessionId(conn.session_id);
          setStatus("connected", conn.version);
          return;
        } catch (e) {
          console.warn(`[NonclawApp] Connect failed (attempt ${i + 1}):`, e);
          if (i === RETRY_DELAYS_MS.length && !cancelled) setStatus("disconnected");
        }
      }
    }

    void autoConnect();
    return () => {
      cancelled = true;
    };
  }, [appLayerOwnsLifecycle, daemonUrl]);

  const inner = (
    <BasePathContext.Provider value={resolvedBasePath}>
      <div className={className}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<ChatPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="runs" element={<RunsPage access={runAccess} />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </div>
    </BasePathContext.Provider>
  );

  return useRouter ? <MemoryRouter>{inner}</MemoryRouter> : inner;
}
NonclawApp.displayName = "NonclawApp";
