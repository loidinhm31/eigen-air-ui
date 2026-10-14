import type {
  Skill,
  SkillPackageDetailDTO,
  SkillResourceResponse,
  SkillSearchResult,
} from "@eigen-air-ui/shared/types";

export interface SkillListOptions {
  includeDisabled?: boolean;
  signal?: AbortSignal;
}

export interface SkillSearchOptions {
  signal?: AbortSignal;
}

export interface SkillGetOptions {
  signal?: AbortSignal;
}

export interface SkillImportOptions {
  signal?: AbortSignal;
}

export interface SkillReplaceOptions {
  contentRevision: string;
  installId: string;
  filename?: string;
  signal?: AbortSignal;
}

export interface SkillSetEnabledOptions {
  localRevision: number;
  installId?: string;
  inspectedRevision?: string;
  signal?: AbortSignal;
}

export interface SkillUninstallOptions {
  contentRevision: string;
  installId: string;
  signal?: AbortSignal;
}

export interface SkillResourceOptions {
  contentRevision?: string;
  installId?: string;
  signal?: AbortSignal;
}

export interface ISkillService {
  list(options?: SkillListOptions): Promise<Skill[]>;
  search(query: string, options?: SkillSearchOptions): Promise<SkillSearchResult[]>;
  get(id: string, options?: SkillGetOptions): Promise<SkillPackageDetailDTO>;
  importPackage(file: File | Blob, filename?: string, options?: SkillImportOptions): Promise<Skill>;
  replacePackage(
    id: string,
    file: File | Blob,
    options: SkillReplaceOptions
  ): Promise<Skill>;
  setEnabled(
    id: string,
    enabled: boolean,
    options: SkillSetEnabledOptions
  ): Promise<Skill>;
  uninstall(
    id: string,
    options: SkillUninstallOptions
  ): Promise<void>;
  getResource(
    id: string,
    path: string,
    options?: SkillResourceOptions
  ): Promise<SkillResourceResponse>;
}
