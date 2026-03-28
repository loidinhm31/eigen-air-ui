import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { NonclawApp } from "@nonclaw-ui/ui/embed";
import { getConfigService, getChatService } from "@nonclaw-ui/ui";
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
        try {
          const conn = await getChatService().connect();
          if (!cancelled) setSessionId(conn.session_id);
        } catch {
          // WS optional — REST still works without a session
        }
      } catch {
        if (!cancelled) setStatus("disconnected");
      }
    }

    checkHealth();
    return () => {
      cancelled = true;
    };
  }, [setStatus, setSessionId]);

  return (
    <BrowserRouter>
      <NonclawApp useRouter={false} />
    </BrowserRouter>
  );
}
