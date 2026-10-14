import type {
  ISkillService,
  SkillGetOptions,
  SkillImportOptions,
  SkillListOptions,
  SkillReplaceOptions,
  SkillResourceOptions,
  SkillSearchOptions,
  SkillSetEnabledOptions,
  SkillUninstallOptions,
} from "../factory/interfaces/ISkillService.js";
import type {
  Skill,
  SkillPackageDetailDTO,
  SkillResourceResponse,
  SkillSearchResult,
} from "@eigen-air-ui/shared/types";
import {
  fetchWithAccess,
  type AccessSource,
  type HttpRequestMode,
} from "./AuthenticatedHttpRequest.js";
import {
  SkillHttpError,
  type SkillHttpErrorKind,
  errorKindForSkillStatus,
  extractSkillErrorPayload,
} from "./skill-error-helpers.js";

export { SkillHttpError, type SkillHttpErrorKind };

function quoteRevision(rev: string): string {
  const trimmed = rev.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

export class HttpSkillAdapter implements ISkillService {

  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private getAccessRevision(): number | undefined {
    const current = typeof this.access === "function" ? this.access() : this.access;
    return current?.accessRevision;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    mode: HttpRequestMode = "protected"
  ): Promise<T> {
    const startRevision = this.getAccessRevision();

    try {
      const res = await fetchWithAccess(this.baseUrl, path, this.access, init, mode);

      if (startRevision !== undefined) {
        const currentRevision = this.getAccessRevision();
        if (currentRevision !== undefined && currentRevision !== startRevision) {
          throw new SkillHttpError(
            0,
            "aborted",
            "Skill request discarded due to credential or principal rotation"
          );
        }
      }



      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        const { message, code } = extractSkillErrorPayload(raw);
        const kind = errorKindForSkillStatus(res.status, code);
        throw new SkillHttpError(
          res.status,
          kind,
          message ?? `Request failed: ${res.status}`,
          code
        );
      }

      if (res.status === 204) {
        return undefined as T;
      }

      return (await res.json()) as T;
    } catch (cause) {
      if (cause instanceof SkillHttpError) {
        throw cause;
      }
      if (
        (cause instanceof DOMException && cause.name === "AbortError") ||
        (cause instanceof Error && cause.name === "AbortError")
      ) {
        throw new SkillHttpError(0, "aborted", "Skill request was cancelled");
      }
      const msg = cause instanceof Error ? cause.message : "Network communication failed";
      throw new SkillHttpError(0, "network_error", msg);
    }
  }

  list(options?: SkillListOptions): Promise<Skill[]> {
    const path = options?.includeDisabled ? "/v1/skills?include_disabled=true" : "/v1/skills";
    const mode: HttpRequestMode = options?.includeDisabled ? "protected" : "public";
    return this.request(path, { signal: options?.signal }, mode);
  }

  search(query: string, options?: SkillSearchOptions): Promise<SkillSearchResult[]> {
    return this.request(
      `/v1/skills/search?q=${encodeURIComponent(query)}`,
      { signal: options?.signal },
      "public"
    );
  }

  get(id: string, options?: SkillGetOptions): Promise<SkillPackageDetailDTO> {
    return this.request(
      `/v1/skills/${encodeURIComponent(id)}`,
      { signal: options?.signal },
      "protected"
    );
  }

  importPackage(
    file: File | Blob,
    filename = "skill.zip",
    options?: SkillImportOptions
  ): Promise<Skill> {
    const formData = new FormData();
    formData.append("file", file, filename);

    return this.request(
      "/v1/skills/import",
      {
        method: "POST",
        body: formData,
        signal: options?.signal,
      },
      "protected"
    );
  }

  replacePackage(
    id: string,
    file: File | Blob,
    options: SkillReplaceOptions
  ): Promise<Skill> {
    const formData = new FormData();
    formData.append("file", file, options.filename ?? "package.zip");

    const headers: Record<string, string> = {
      "If-Match": quoteRevision(options.contentRevision),
      "x-skill-install-id": options.installId,
    };

    return this.request(
      `/v1/skills/${encodeURIComponent(id)}/package`,
      {
        method: "PUT",
        headers,
        body: formData,
        signal: options?.signal,
      },
      "protected"
    );
  }

  setEnabled(
    id: string,
    enabled: boolean,
    options: SkillSetEnabledOptions
  ): Promise<Skill> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "If-Match": quoteRevision(String(options.localRevision)),
    };

    const body: Record<string, unknown> = {
      enabled,
    };
    if (options.installId !== undefined) {
      body.install_id = options.installId;
    }
    if (options.inspectedRevision !== undefined) {
      body.inspected_content_revision = options.inspectedRevision;
    }

    return this.request(
      `/v1/skills/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      },
      "protected"
    );
  }

  uninstall(id: string, options: SkillUninstallOptions): Promise<void> {
    const headers: Record<string, string> = {
      "If-Match": quoteRevision(options.contentRevision),
      "x-skill-install-id": options.installId,
    };

    return this.request<void>(
      `/v1/skills/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers,
        signal: options?.signal,
      },
      "protected"
    );
  }

  getResource(
    id: string,
    path: string,
    options?: SkillResourceOptions
  ): Promise<SkillResourceResponse> {
    const headers: Record<string, string> = {};
    if (options?.contentRevision) {
      headers["If-Match"] = quoteRevision(options.contentRevision);
    }
    if (options?.installId) {
      headers["x-skill-install-id"] = options.installId;
    }

    return this.request(
      `/v1/skills/${encodeURIComponent(id)}/resources?path=${encodeURIComponent(path)}`,
      {
        method: "GET",
        headers,
        signal: options?.signal,
      },
      "protected"
    );
  }
}
