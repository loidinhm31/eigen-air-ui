import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/templates/AppShell.js";
import { ChatPage } from "../components/pages/ChatPage.js";
import { MemoryPage } from "../components/pages/MemoryPage.js";
import { ToolsPage } from "../components/pages/ToolsPage.js";
import { SkillsPage } from "../components/pages/SkillsPage.js";
import { SessionsPage } from "../components/pages/SessionsPage.js";
import { SettingsPage } from "../components/pages/SettingsPage.js";
import { useConnectionStore } from "../stores/connectionStore.js";
import {
  setChatService,
  setMemoryService,
  setToolService,
  setSkillService,
  setConfigService,
  setSessionService,
  setVaultKnowledgeService,
  getChatService,
  getConfigService,
  hasReinitFn,
} from "../adapters/factory/ServiceFactory.js";
import { WsChatAdapter } from "../adapters/ws/WsChatAdapter.js";
import { HttpMemoryAdapter } from "../adapters/http/HttpMemoryAdapter.js";
import { HttpToolAdapter } from "../adapters/http/HttpToolAdapter.js";
import { HttpSkillAdapter } from "../adapters/http/HttpSkillAdapter.js";
import { HttpConfigAdapter } from "../adapters/http/HttpConfigAdapter.js";
import { HttpVaultKnowledgeAdapter } from "../adapters/http/HttpVaultKnowledgeAdapter.js";

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
}

export function NonclawApp({
  useRouter = true,
  basePath: _basePath,
  embedded: _embedded,
  className,
  onLogoutRequest: _onLogoutRequest,
}: NonclawAppProps) {
  const daemonUrl = useConnectionStore((state) => state.url);

  React.useEffect(() => {
    // In apps/web (or any context where an app-layer init.ts has called
    // registerReinitFn), the app layer owns the full service lifecycle:
    //   • initial creation: apps/web/src/init.ts + main.tsx
    //   • URL changes:      ConnectionStatus.handleConnect() → reinitServices()
    //   • auto-connect:     App.tsx useEffect
    //
    // We MUST NOT touch services here in that case — doing so would disconnect
    // the WebSocket that ConnectionStatus just established.
    if (hasReinitFn()) return;

    // Standalone / embedded fallback: no app-layer init registered, so we
    // own the full service lifecycle here.
    const normalizedUrl = daemonUrl.replace(/\/+$/, "");
    const wsUrl = normalizedUrl.startsWith("https")
      ? normalizedUrl.replace("https", "wss") + "/ws"
      : normalizedUrl.replace("http", "ws") + "/ws";

    const wsAdapter = new WsChatAdapter(wsUrl);
    setChatService(wsAdapter);
    setSessionService(wsAdapter);
    setMemoryService(new HttpMemoryAdapter(normalizedUrl));
    setToolService(new HttpToolAdapter(normalizedUrl));
    setSkillService(new HttpSkillAdapter(normalizedUrl));
    setConfigService(new HttpConfigAdapter(normalizedUrl));
    setVaultKnowledgeService(new HttpVaultKnowledgeAdapter(normalizedUrl));

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
          const health = await getConfigService().health();
          if (cancelled) return;
          setStatus("connected", health.version);
          try {
            const conn = await getChatService().connect();
            if (!cancelled) setSessionId(conn.session_id);
          } catch (e) {
            console.warn("[NonclawApp] WS connect failed:", e);
          }
          return;
        } catch (e) {
          console.warn(`[NonclawApp] Health check failed (attempt ${i + 1}):`, e);
          if (i === RETRY_DELAYS_MS.length && !cancelled) setStatus("disconnected");
        }
      }
    }

    void autoConnect();
    return () => {
      cancelled = true;
    };
  }, [daemonUrl]);

  const inner = (
    <div className={className}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<ChatPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </div>
  );

  return useRouter ? <MemoryRouter>{inner}</MemoryRouter> : inner;
}
NonclawApp.displayName = "NonclawApp";
