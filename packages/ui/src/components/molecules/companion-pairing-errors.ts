import { sanitizePathText } from "./path-privacy.js";
export interface PairingResolutionOutcome {
  readonly message: string;
  readonly remainingAttempts: number | null;
  readonly isTerminal: boolean;
}

export function resolvePairingError(err: unknown): PairingResolutionOutcome {
  if (typeof err !== "object" || err === null) {
    return {
      message: "Pairing approval failed",
      remainingAttempts: null,
      isTerminal: false,
    };
  }

  if ("code" in err && typeof err.code === "string") {
    if (err.code === "invalid_code") {
      let attempts: number | null = null;
      if ("remaining_attempts" in err && typeof err.remaining_attempts === "number") {
        attempts = err.remaining_attempts;
      } else if ("message" in err && typeof err.message === "string") {
        const match = err.message.match(/(\d+)\s+attempts?\s+remaining/i);
        if (match) {
          attempts = parseInt(match[1], 10);
        }
      }
      return {
        message: attempts !== null
          ? `Invalid verification code (${attempts} attempts remaining)`
          : "Invalid verification code",
        remainingAttempts: attempts,
        isTerminal: false,
      };
    }

    if (err.code === "attempt_limit_exceeded") {
      return {
        message: "Maximum verification attempts exceeded; pairing flow denied",
        remainingAttempts: 0,
        isTerminal: true,
      };
    }

    if (err.code === "expired") {
      return {
        message: "Pairing session expired. Please start a new session on your companion.",
        remainingAttempts: null,
        isTerminal: true,
      };
    }

    if (err.code === "not_found") {
      return {
        message: "Pairing session not found. Please verify the Pairing ID.",
        remainingAttempts: null,
        isTerminal: false,
      };
    }

    if (err.code === "already_finalized") {
      return {
        message: "Pairing session already finalized.",
        remainingAttempts: null,
        isTerminal: true,
      };
    }

    if (err.code === "rate_limited") {
      return {
        message: "Too many pairing attempts. Please wait before retrying.",
        remainingAttempts: null,
        isTerminal: false,
      };
    }

    if ("message" in err && typeof err.message === "string") {
      return {
        message: sanitizePathText(err.message),
        remainingAttempts: null,
        isTerminal: false,
      };
    }
  }

  if (err instanceof Error) {
    return {
      message: sanitizePathText(err.message),
      remainingAttempts: null,
      isTerminal: false,
    };
  }

  return {
    message: "Pairing approval failed",
    remainingAttempts: null,
    isTerminal: false,
  };
}
