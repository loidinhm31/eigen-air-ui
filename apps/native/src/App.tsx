import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { NonclawApp } from "@nonclaw-ui/ui/embed";
import { getConfigService, getChatService } from "@nonclaw-ui/ui";
import { useConnectionStore } from "@nonclaw-ui/ui/stores";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export default function App() {
  const setStatus = useConnectionStore((s) => s.setStatus);
  const setSessionId = useConnectionStore((s) => s.setSessionId);

  useEffect(() => {
    let cancelled = false;

    async function autoConnect() {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (cancelled) return;

        if (attempt > 0) {
          await new Promise<void>((res) => {
            const t = setTimeout(res, RETRY_DELAYS_MS[attempt - 1]);
            const iv = setInterval(() => { if (cancelled) { clearTimeout(t); clearInterval(iv); res(); } }, 100);
          });
        }
        if (cancelled) return;

        setStatus("connecting");
        try {
          const health = await getConfigService().health();
          if (cancelled) return;
          setStatus("connected", health.version);

          try {
            const conn = await getChatService().connect();
            if (!cancelled) setSessionId(conn.session_id);
          } catch (e) {
            console.warn("[App] WS connect failed:", e);
          }
          return;
        } catch (e) {
          const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
          console.warn(`[App] Health check failed (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}):`, e);
          if (isLastAttempt && !cancelled) setStatus("disconnected");
        }
      }
    }

    void autoConnect();
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
