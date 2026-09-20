import type { ChatDebugData, ChatMessage } from "../types/api.js";

export interface DebugTraceSnapshot {
  timestamp: string;
  session_id?: string;
  daemon_url?: string;
  connection_status?: string;
  connection_version?: string;
  message?: {
    id?: string;
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  };
  debug?: ChatDebugData;
  question_state?: {
    status?: string;
    error?: string | null;
    active_question_id?: string;
  };
  stream_state?: {
    status?: string | null;
    error?: string | null;
  };
  user_agent?: string;
}

export interface BuildDebugTraceOptions {
  message?: ChatMessage;
  debug?: ChatDebugData;
  sessionId?: string;
  daemonUrl?: string;
  connectionStatus?: string;
  connectionVersion?: string;
  questionState?: {
    status?: string;
    error?: string | null;
    activeQuestionId?: string;
  };
  streamState?: {
    status?: string | null;
    error?: string | null;
  };
}

export function buildDebugTrace(options: BuildDebugTraceOptions): DebugTraceSnapshot {
  const resolvedDebug = options.debug ?? options.message?.debug;
  return {
    timestamp: new Date().toISOString(),
    ...(options.sessionId ? { session_id: options.sessionId } : {}),
    ...(options.daemonUrl ? { daemon_url: options.daemonUrl } : {}),
    ...(options.connectionStatus ? { connection_status: options.connectionStatus } : {}),
    ...(options.connectionVersion ? { connection_version: options.connectionVersion } : {}),
    ...(options.message
      ? {
          message: {
            ...(options.message.id ? { id: options.message.id } : {}),
            role: options.message.role,
            content: options.message.content,
            ...(options.message.tool_calls ? { tool_calls: options.message.tool_calls } : {}),
            ...(options.message.tool_call_id ? { tool_call_id: options.message.tool_call_id } : {}),
          },
        }
      : {}),
    ...(resolvedDebug ? { debug: resolvedDebug } : {}),
    ...(options.questionState
      ? {
          question_state: {
            ...(options.questionState.status ? { status: options.questionState.status } : {}),
            error: options.questionState.error ?? null,
            ...(options.questionState.activeQuestionId
              ? { active_question_id: options.questionState.activeQuestionId }
              : {}),
          },
        }
      : {}),
    ...(options.streamState
      ? {
          stream_state: {
            status: options.streamState.status ?? null,
            error: options.streamState.error ?? null,
          },
        }
      : {}),
    ...(typeof navigator !== "undefined" && navigator.userAgent
      ? { user_agent: navigator.userAgent }
      : {}),
  };
}

export async function copyDebugTrace(
  trace: DebugTraceSnapshot | Record<string, unknown> | string
): Promise<boolean> {
  const text = typeof trace === "string" ? trace : JSON.stringify(trace, null, 2);
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to execCommand
  }
  try {
    if (typeof document !== "undefined" && document.body) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    }
  } catch {
    return false;
  }
  return false;
}
