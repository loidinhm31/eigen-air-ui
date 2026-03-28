import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/templates/AppShell.js";
import { ChatPage } from "../components/pages/ChatPage.js";
import { MemoryPage } from "../components/pages/MemoryPage.js";
import { ToolsPage } from "../components/pages/ToolsPage.js";
import { SkillsPage } from "../components/pages/SkillsPage.js";
import { SessionsPage } from "../components/pages/SessionsPage.js";
import { SettingsPage } from "../components/pages/SettingsPage.js";

interface NonclawAppProps {
  useRouter?: boolean;
}

export function NonclawApp({ useRouter = true }: NonclawAppProps) {
  const inner = (
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
  );

  return useRouter ? <MemoryRouter>{inner}</MemoryRouter> : inner;
}
NonclawApp.displayName = "NonclawApp";
