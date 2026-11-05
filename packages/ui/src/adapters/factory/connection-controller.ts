import type { ConnectResponse, ConnectionErrorKind } from "@eigen-air-ui/shared/types";
import { useConnectionStore } from "../../stores/connectionStore.js";
import {
  getChatService,
  getConfigService,
  getServiceAccessContext,
} from "./ServiceFactory.js";
import type { IChatService } from "./interfaces/IChatService.js";
import type { IConfigService } from "./interfaces/IConfigService.js";
import { isWsRequestError } from "../ws/ws-request-error.js";

export const CONNECT_HEALTH_TIMEOUT_MS = 10_000;
export const AUTO_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

export type ConnectIntent = "auto" | "manual" | "access-change";

export interface ConnectRequest {
  intent: ConnectIntent;
  beforeConnect?: () => void;
}

export class ConnectSupersededError extends Error {
  constructor(message = "Connect superseded") {
    super(message);
    this.name = "ConnectSupersededError";
  }
}

export class HealthTimeoutError extends Error {
  constructor(message = "Health check timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

interface AttemptRecord {
  generation: number;
  state: "initializing" | "running";
  accessRevision?: number;
  service?: IChatService;
  abort: AbortController;
  promise: Promise<ConnectResponse>;
}

let currentGeneration = 0;
let autoConnectEpoch = 0;
let activeAttempt: AttemptRecord | null = null;

export function classifyConnectError(error: unknown): ConnectionErrorKind {
  if (isWsRequestError(error, "unauthorized")) {
    return "unauthenticated";
  }
  if (isWsRequestError(error, "unsupported_daemon")) {
    return "unsupported_daemon";
  }
  if (isWsRequestError(error, "timeout")) {
    return "timeout";
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      (error.name === "AbortError" && error.message.includes("timed out")) ||
      error.message.includes("timeout") ||
      error.message.includes("timed out"))
  ) {
    return "timeout";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "timeout"
  ) {
    return "timeout";
  }
  return "unreachable";
}

export function connectChat(request: ConnectRequest): Promise<ConnectResponse> {
  if (activeAttempt) {
    let currentService: IChatService | undefined;
    try {
      currentService = getChatService();
    } catch {
      // Chat service not yet initialized
    }

    if (request.intent === "auto") {
      if (
        activeAttempt.state === "initializing" ||
        (currentService && activeAttempt.service === currentService)
      ) {
        return activeAttempt.promise;
      }
    }
    if (request.intent === "access-change") {
      const currentRevision = getServiceAccessContext().accessRevision ?? 0;
      if (
        activeAttempt.state === "initializing" ||
        (currentService &&
          activeAttempt.service === currentService &&
          activeAttempt.accessRevision !== undefined &&
          activeAttempt.accessRevision >= currentRevision)
      ) {
        return activeAttempt.promise;
      }
    }
    // Supersede active attempt
    activeAttempt.abort.abort();
    activeAttempt = null;
  }

  const generation = ++currentGeneration;
  const abortController = new AbortController();
  let resolvePromise!: (val: ConnectResponse) => void;
  let rejectPromise!: (err: unknown) => void;
  const promise = new Promise<ConnectResponse>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // Prevent unhandled rejection warning if consumers attach handlers asynchronously
  promise.catch(() => {});

  const attempt: AttemptRecord = {
    generation,
    state: "initializing",
    abort: abortController,
    promise,
  };
  activeAttempt = attempt;

  try {
    request.beforeConnect?.();
  } catch (err) {
    if (activeAttempt === attempt) {
      activeAttempt = null;
    }
    rejectPromise(err);
    return promise;
  }

  if (attempt.abort.signal.aborted || activeAttempt !== attempt) {
    const superseded = new ConnectSupersededError("Connect superseded");
    rejectPromise(superseded);
    return promise;
  }

  let service: IChatService;
  let config: IConfigService;
  try {
    service = getChatService();
    config = getConfigService();
  } catch (err) {
    if (activeAttempt === attempt) {
      activeAttempt = null;
    }
    rejectPromise(err);
    return promise;
  }

  const accessRevision = getServiceAccessContext().accessRevision ?? 0;
  attempt.service = service;
  attempt.accessRevision = accessRevision;
  attempt.state = "running";

  const store = useConnectionStore.getState();
  store.setStatus("connecting");
  store.setError(undefined);

  void (async () => {
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | number | undefined;
    const healthAbortController = new AbortController();

    const onAttemptAbort = () => {
      healthAbortController.abort();
    };
    if (attempt.abort.signal.aborted) {
      const superseded = new ConnectSupersededError("Connect superseded");
      if (activeAttempt === attempt) {
        activeAttempt = null;
      }
      rejectPromise(superseded);
      return;
    }
    attempt.abort.signal.addEventListener("abort", onAttemptAbort);

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          healthAbortController.abort();
          reject(new HealthTimeoutError());
        }, CONNECT_HEALTH_TIMEOUT_MS);
      });

      await Promise.race([
        config.health(healthAbortController.signal),
        timeoutPromise,
      ]);
    } catch (err) {
      if (timedOut) {
        handleAttemptFailure(attempt, service, new HealthTimeoutError(), rejectPromise);
        return;
      }
      if (attempt.abort.signal.aborted) {
        handleAttemptFailure(
          attempt,
          service,
          new ConnectSupersededError("Connect superseded"),
          rejectPromise
        );
        return;
      }
      handleAttemptFailure(attempt, service, err, rejectPromise);
      return;
    } finally {
      clearTimeout(timeoutId);
      attempt.abort.signal.removeEventListener("abort", onAttemptAbort);
    }

    if (!isAttemptCurrent(attempt)) {
      handleAttemptFailure(
        attempt,
        service,
        new ConnectSupersededError("Connect superseded"),
        rejectPromise
      );
      return;
    }

    let connectRes: ConnectResponse;
    try {
      connectRes = await service.connect(undefined, {
        signal: attempt.abort.signal,
      });
    } catch (err) {
      handleAttemptFailure(attempt, service, err, rejectPromise);
      return;
    }

    if (!isAttemptCurrent(attempt)) {
      handleAttemptFailure(
        attempt,
        service,
        new ConnectSupersededError("Connect superseded"),
        rejectPromise
      );
      return;
    }

    // Success!
    const successStore = useConnectionStore.getState();
    successStore.setSessionId(connectRes.session_id);
    successStore.setStatus("connected", connectRes.version);
    successStore.setError(undefined);

    if (activeAttempt === attempt) {
      activeAttempt = null;
    }
    resolvePromise(connectRes);
  })();

  return promise;
}

function isAttemptCurrent(attempt: AttemptRecord): boolean {
  try {
    return (
      attempt.generation === currentGeneration &&
      !attempt.abort.signal.aborted &&
      attempt.service === getChatService()
    );
  } catch {
    return false;
  }
}

function handleAttemptFailure(
  attempt: AttemptRecord,
  service: IChatService,
  err: unknown,
  rejectPromise: (err: unknown) => void
): void {
  const isCurrent = isAttemptCurrent(attempt);
  if (!isCurrent) {
    const superseded =
      err instanceof ConnectSupersededError
        ? err
        : new ConnectSupersededError("Connect superseded");
    if (activeAttempt === attempt) {
      activeAttempt = null;
    }
    rejectPromise(superseded);
    return;
  }

  try {
    service.disconnect();
  } catch {
    // Ignore disconnect failure during error cleanup
  }
  const errorKind = classifyConnectError(err);
  const store = useConnectionStore.getState();
  store.setStatus("disconnected");
  store.setError(errorKind);

  if (activeAttempt === attempt) {
    activeAttempt = null;
  }
  rejectPromise(err);
}

export function startAutoConnect(): () => void {
  let cancelled = false;
  let sleepTimer: ReturnType<typeof setTimeout> | number | undefined;
  const myEpoch = autoConnectEpoch;

  async function runLoop() {
    for (let attemptIdx = 0; attemptIdx <= AUTO_RETRY_DELAYS_MS.length; attemptIdx++) {
      if (cancelled || autoConnectEpoch !== myEpoch) return;
      if (attemptIdx > 0) {
        const delay = AUTO_RETRY_DELAYS_MS[attemptIdx - 1];
        await new Promise<void>((resolve) => {
          sleepTimer = setTimeout(resolve, delay);
        });
        sleepTimer = undefined;
        if (cancelled || autoConnectEpoch !== myEpoch) return;
        if (useConnectionStore.getState().status === "connected") return;
      }

      try {
        await connectChat({ intent: "auto" });
        return; // success — stop retrying
      } catch (error) {
        if (cancelled || autoConnectEpoch !== myEpoch) return;
        if (error instanceof ConnectSupersededError) {
          return; // superseded by manual or another connect
        }
        const errorKind = classifyConnectError(error);
        if (errorKind === "unauthenticated" || errorKind === "unsupported_daemon") {
          return; // terminal for auto loop
        }
        // Otherwise, continue retry loop
      }
    }
  }

  void runLoop();

  return () => {
    cancelled = true;
    clearTimeout(sleepTimer);
    sleepTimer = undefined;
  };
}

export function disconnectChat(): void {
  autoConnectEpoch++;
  if (activeAttempt) {
    activeAttempt.abort.abort();
    activeAttempt = null;
  }
  currentGeneration++;
  try {
    getChatService().disconnect();
  } catch {
    // Ignore disconnect failure
  }
  const store = useConnectionStore.getState();
  store.setStatus("disconnected");
  store.setError(undefined);
}

export function resetConnectionControllerForTests(): void {
  autoConnectEpoch++;
  if (activeAttempt) {
    activeAttempt.abort.abort();
    activeAttempt = null;
  }
  currentGeneration = 0;
}
