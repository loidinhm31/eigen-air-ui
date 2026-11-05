import * as React from "react";
import { NavLink } from "react-router-dom";
import { useConnectionStore } from "../../stores/connectionStore.js";
import type { ConnectionErrorKind } from "@eigen-air-ui/shared/types";

export const CONNECTION_ERROR_MESSAGES: Record<"unauthenticated" | "unsupported_daemon", string> = {
  unauthenticated: "Authentication required. Enter the daemon token (config.toml `[server].token`) in Settings.",
  unsupported_daemon: "This daemon version is not compatible with the UI. Upgrade the daemon.",
};

export function getConnectionErrorMessage(error: ConnectionErrorKind | undefined): string | null {
  if (error === "unauthenticated" || error === "unsupported_daemon") {
    return CONNECTION_ERROR_MESSAGES[error];
  }
  return null;
}

export function ConnectionErrorNotice(): React.ReactElement | null {
  const error = useConnectionStore((s) => s.error);
  const message = getConnectionErrorMessage(error);

  if (!message) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive"
    >
      <span>{message}</span>
      <NavLink
        to="settings"
        className="shrink-0 font-medium underline hover:text-destructive/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        Settings
      </NavLink>
    </div>
  );
}
ConnectionErrorNotice.displayName = "ConnectionErrorNotice";
