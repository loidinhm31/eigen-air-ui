import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { EigenAirApp } from "@eigen-air-ui/ui/embed";
import { startAutoConnect } from "@eigen-air-ui/ui";
import { useConnectionStore, useInferenceStore } from "@eigen-air-ui/ui/stores";

export default function App() {
  const status = useConnectionStore((s) => s.status);

  useEffect(() => startAutoConnect(), []);

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
