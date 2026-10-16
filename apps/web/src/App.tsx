import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { EigenAirApp } from "@eigen-air-ui/ui/embed";
import { getConfigService, getChatService } from "@eigen-air-ui/ui";
import { useConnectionStore, useInferenceStore } from "@eigen-air-ui/ui/stores";
/** Delays in ms between successive health-check retries (5 total attempts). */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export default function App() {
  const status = useConnectionStore((s) => s.status);
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

  useEffect(() => {
    let refreshTimer: number | undefined;

    function triggerCoalescedRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (useConnectionStore.getState().status === "connected") {
          void useInferenceStore.getState().fetchAll();
        }
      }, 300);
    }

    if (status === "connected") {
      triggerCoalescedRefresh();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        triggerCoalescedRefresh();
      }
    }

    function handleFocus() {
      triggerCoalescedRefresh();
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(refreshTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status]);

  return (
    <BrowserRouter>
      <EigenAirApp useRouter={false} />
    </BrowserRouter>
  );
}
