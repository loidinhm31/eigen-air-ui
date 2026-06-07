import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { NonclawApp } from "@nonclaw-ui/ui/embed";
import { getConfigService, getChatService } from "@nonclaw-ui/ui";
import { useConnectionStore } from "@nonclaw-ui/ui/stores";

/** Delays in ms between successive health-check retries (5 total attempts). */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export default function App() {
  const setStatus = useConnectionStore((s) => s.setStatus);
  const setSessionId = useConnectionStore((s) => s.setSessionId);

  useEffect(() => {
    let cancelled = false;

    async function autoConnect() {
      for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
        if (cancelled) return;

        if (i > 0) {
          // Simple sleep — cancelled check resumes on next iteration.
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
          return; // success — stop retrying
        } catch (e) {
          console.warn(`[App] Connect failed (attempt ${i + 1}):`, e);
          if (i === RETRY_DELAYS_MS.length && !cancelled) setStatus("disconnected");
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
