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
} from "../adapters/factory/ServiceFactory.js";
import { WsChatAdapter } from "../adapters/ws/WsChatAdapter.js";
import { HttpMemoryAdapter } from "../adapters/http/HttpMemoryAdapter.js";
import { HttpToolAdapter } from "../adapters/http/HttpToolAdapter.js";
import { HttpSkillAdapter } from "../adapters/http/HttpSkillAdapter.js";
import { HttpConfigAdapter } from "../adapters/http/HttpConfigAdapter.js";

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
    const wsUrl = daemonUrl.startsWith("https")
      ? daemonUrl.replace("https", "wss") + "/ws"
      : daemonUrl.replace("http", "ws") + "/ws";

    setChatService(new WsChatAdapter(wsUrl));
    setMemoryService(new HttpMemoryAdapter(daemonUrl));
    setToolService(new HttpToolAdapter(daemonUrl));
    setSkillService(new HttpSkillAdapter(daemonUrl));
    setConfigService(new HttpConfigAdapter(daemonUrl));
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
