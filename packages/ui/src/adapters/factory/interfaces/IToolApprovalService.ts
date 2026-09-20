import type {
  ToolApprovalListResponse,
  ToolApprovalResolveDecision,
  ToolApprovalSnapshot,
} from "@nonclaw-ui/shared/types";

export interface ToolApprovalListQuery {
  sessionId: string;
  runId: string;
  limit?: number;
}

export interface ToolApprovalDetailQuery {
  sessionId: string;
  runId: string;
}

export interface IToolApprovalService {
  list(
    query: { sessionId: string; runId: string; limit?: number },
    signal?: AbortSignal
  ): Promise<ToolApprovalListResponse>;
  get(
    approvalId: string,
    query: { sessionId: string; runId: string },
    signal?: AbortSignal
  ): Promise<ToolApprovalSnapshot>;
  resolve(
    approvalId: string,
    query: { sessionId: string; runId: string },
    expectedRevision: number,
    decision: ToolApprovalResolveDecision,
    signal?: AbortSignal
  ): Promise<ToolApprovalSnapshot>;
}
