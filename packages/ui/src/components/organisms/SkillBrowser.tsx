import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { getSkillService } from "../../adapters/factory/ServiceFactory.js";
import { SkillCard } from "../molecules/SkillCard.js";
import { Input } from "../atoms/Input.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import { Badge } from "../atoms/Badge.js";
import type {
  Skill,
  SkillPackageDetailDTO,
  SkillResourceResponse,
  SkillSearchResult,
} from "@eigen-air-ui/shared/types";
import { SkillHttpError } from "../../adapters/http/HttpSkillAdapter.js";

export function SkillBrowser() {
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inspection modal state
  const [inspectedDetail, setInspectedDetail] = useState<SkillPackageDetailDTO | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectResource, setInspectResource] = useState<SkillResourceResponse | null>(null);
  const [inspectResourceLoading, setInspectResourceLoading] = useState(false);

  // Replace modal state
  const [replacingSkill, setReplacingSkill] = useState<Skill | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Uninstall modal state
  const [uninstallingSkill, setUninstallingSkill] = useState<Skill | null>(null);

  // Upload file input ref
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  async function loadSkills() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await getSkillService().list({ includeDisabled: true });
      setSkills(data);
      if (query.trim()) {
        const results = await getSkillService().search(query.trim());
        setSearchResults(results);
      }
    } catch (err) {
      if (err instanceof SkillHttpError && err.kind === "aborted") {
        return;
      }
      if (err instanceof SkillHttpError && (err.status === 401 || err.status === 403)) {
        try {
          const data = await getSkillService().list({ includeDisabled: false });
          setSkills(data);
          if (query.trim()) {
            const results = await getSkillService().search(query.trim());
            setSearchResults(results);
          }
        } catch (fallbackErr) {
          if (!(fallbackErr instanceof SkillHttpError && fallbackErr.kind === "aborted")) {
            setErrorMessage(fallbackErr instanceof Error ? fallbackErr.message : "Failed to load skills");
          }
        }
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to load skills");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, []);

  async function handleSearch() {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const results = await getSkillService().search(query.trim());
      setSearchResults(results);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so re-selecting same file triggers event
    e.target.value = "";

    setMutating(true);
    setErrorMessage(null);
    try {
      const created = await getSkillService().importPackage(file, file.name);
      await loadSkills();
      // Automatically open inspection panel for the newly imported package
      await openInspection(created.id);
    } catch (err) {
      if (err instanceof SkillHttpError) {
        if (err.kind === "conflict") {
          setErrorMessage("A skill with this ID already exists or an import is currently in progress.");
        } else if (err.kind === "payload_too_large") {
          setErrorMessage("Package size exceeds the upload quota or archive limits.");
        } else if (err.kind === "unsupported_media_type" || err.kind === "invalid") {
          setErrorMessage("Invalid package archive: must be a valid ZIP/.skill file with SKILL.md.");
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Upload failed");
      }
    } finally {
      setMutating(false);
    }
  }

  async function openInspection(id: string) {
    setInspectLoading(true);
    setInspectResource(null);
    setErrorMessage(null);
    try {
      const detail = await getSkillService().get(id);
      setInspectedDetail(detail);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to inspect skill details");
    } finally {
      setInspectLoading(false);
    }
  }

  async function handleInspectResource(path: string) {
    if (!inspectedDetail) return;
    setInspectResourceLoading(true);
    try {
      const res = await getSkillService().getResource(inspectedDetail.id, path, {
        contentRevision: inspectedDetail.content_revision ?? undefined,
        installId: inspectedDetail.install_id ?? undefined,
      });
      setInspectResource(res);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load resource preview");
    } finally {
      setInspectResourceLoading(false);
    }
  }

  async function handleEnableFromInspection() {
    if (!inspectedDetail) return;
    const targetId = inspectedDetail.id;
    if (inspectedDetail.local_state_revision === undefined || inspectedDetail.local_state_revision === null) {
      setErrorMessage("Missing local state revision for skill.");
      return;
    }
    setMutating(true);
    setErrorMessage(null);
    try {
      const updated = await getSkillService().setEnabled(inspectedDetail.id, true, {
        localRevision: inspectedDetail.local_state_revision,
        installId: inspectedDetail.install_id ?? undefined,
        inspectedRevision: inspectedDetail.content_revision ?? undefined,
      });
      setInspectedDetail((prev) => (prev && prev.id === targetId ? { ...prev, ...updated } : prev));
      await loadSkills();
    } catch (err) {
      if (err instanceof SkillHttpError && err.status === 412) {
        setErrorMessage("Skill content changed before consent could be applied. Please review again.");
        await openInspection(inspectedDetail.id);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to enable skill");
      }
    } finally {
      setMutating(false);
    }
  }

  async function handleToggleEnable(skill: Skill, nextEnabled: boolean) {
    if (nextEnabled) {
      void openInspection(skill.id);
      return;
    }

    if (skill.local_state_revision === undefined || skill.local_state_revision === null) {
      setErrorMessage("Missing local state revision for skill.");
      return;
    }

    setMutating(true);
    setErrorMessage(null);
    try {
      await getSkillService().setEnabled(skill.id, false, {
        localRevision: skill.local_state_revision,
        installId: skill.install_id ?? undefined,
      });
      await loadSkills();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to update skill state");
    } finally {
      setMutating(false);
    }
  }

  async function handleReplaceFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !replacingSkill) return;
    e.target.value = "";

    const targetSkill = replacingSkill;
    if (!targetSkill.content_revision || !targetSkill.install_id) {
      setErrorMessage("Cannot replace: skill missing content revision or install ID.");
      return;
    }

    setMutating(true);
    setErrorMessage(null);
    try {
      await getSkillService().replacePackage(targetSkill.id, file, {
        contentRevision: targetSkill.content_revision,
        installId: targetSkill.install_id,
        filename: file.name,
      });
      setReplacingSkill(null);
      await loadSkills();
      await openInspection(targetSkill.id);
    } catch (err) {
      if (err instanceof SkillHttpError && err.status === 412) {
        setErrorMessage("Replacement conflict: package was modified by another process. Please refresh.");
        setReplacingSkill(null);
        await loadSkills();
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to replace package");
      }
    } finally {
      setMutating(false);
    }
  }

  async function handleConfirmUninstall() {
    if (!uninstallingSkill) return;
    const targetSkill = uninstallingSkill;
    if (!targetSkill.content_revision || !targetSkill.install_id) {
      setErrorMessage("Cannot uninstall: skill missing content revision or install ID.");
      return;
    }
    setMutating(true);
    setErrorMessage(null);
    try {
      await getSkillService().uninstall(targetSkill.id, {
        contentRevision: targetSkill.content_revision,
        installId: targetSkill.install_id,
      });
      setUninstallingSkill(null);
      await loadSkills();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to uninstall package");
    } finally {
      setMutating(false);
    }
  }

  const displaySkills = (query.trim() ? searchResults : skills) || [];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Header controls: Search & Upload */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
          placeholder="Search skills (BM25)..."
          className="flex-1 min-w-[200px]"
        />
        <Button onClick={() => void handleSearch()} disabled={loading || mutating}>
          Search
        </Button>
        <Button
          variant="outline"
          onClick={() => uploadFileInputRef.current?.click()}
          disabled={loading || mutating}
          title="Upload a .skill or .zip package into shared HOME library"
        >
          Upload package
        </Button>
        <input
          ref={uploadFileInputRef}
          type="file"
          accept=".skill,.zip,application/zip"
          className="hidden"
          onChange={(e) => void handleFileUpload(e)}
        />
      </div>

      {/* Error alert banner */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            className="font-bold underline hover:no-underline ml-2"
            onClick={() => setErrorMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      {/* Skills list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2">
          {displaySkills.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {query.trim() ? "No results" : "No skills loaded"}
            </p>
          )}
          {query.trim()
            ? searchResults.map((r) => (
                <SkillCard
                  key={r.id || r.name}
                  skill={r}
                  score={r.score}
                  onInspect={(s) => void openInspection(s.id)}
                  onToggleEnable={(s, next) => void handleToggleEnable(s, next)}
                  onReplace={(s) => setReplacingSkill(s)}
                  onUninstall={(s) => setUninstallingSkill(s)}
                  mutating={mutating}
                />
              ))
            : skills.map((s) => (
                <SkillCard
                  key={s.id || s.name}
                  skill={s}
                  onInspect={(skill) => void openInspection(skill.id)}
                  onToggleEnable={(skill, next) => void handleToggleEnable(skill, next)}
                  onReplace={(skill) => setReplacingSkill(skill)}
                  onUninstall={(skill) => setUninstallingSkill(skill)}
                  mutating={mutating}
                />
              ))}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        {skills.length} skill{skills.length !== 1 ? "s" : ""} in library
        {searchResults.length > 0 && ` · ${searchResults.length} search results`}
      </p>

      {/* Hidden input for replace file selection */}
      <input
        ref={replaceFileInputRef}
        type="file"
        accept=".skill,.zip,application/zip"
        className="hidden"
        onChange={(e) => void handleReplaceFileSelected(e)}
      />

      {/* Inspection Modal */}
      {(inspectedDetail || inspectLoading) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-inspect-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 id="skill-inspect-title" className="text-lg font-semibold font-mono">
                {inspectedDetail ? inspectedDetail.name : "Inspecting Skill..."}
              </h2>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-sm font-bold px-2 py-1"
                onClick={() => {
                  setInspectedDetail(null);
                  setInspectResource(null);
                }}
              >
                ✕
              </button>
            </div>

            {inspectLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : inspectedDetail ? (
              <div className="flex-1 overflow-y-auto space-y-4 text-xs">
                {/* Inert script safety notice */}
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
                  <p className="font-semibold">Inert Package Resources</p>
                  <p className="text-[11px] text-muted-foreground">
                    Foreign scripts and executables inside packages are never executed by Eigen Air. Instructions are provided as guidance for configured native tools only.
                  </p>
                </div>

                {/* Identity & Revision Metadata */}
                <div className="grid grid-cols-2 gap-2 rounded border border-border/60 bg-muted/20 p-2.5">
                  <div>
                    <span className="text-muted-foreground">Stable ID: </span>
                    <span className="font-mono font-medium">{inspectedDetail.id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Version: </span>
                    <span className="font-mono">{inspectedDetail.version ?? "none"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Source: </span>
                    <span className="font-mono capitalize">{inspectedDetail.source}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Format: </span>
                    <span className="font-mono uppercase">{inspectedDetail.format}</span>
                  </div>
                  {inspectedDetail.install_id && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Install ID: </span>
                      <span className="font-mono text-[11px] break-all">{inspectedDetail.install_id}</span>
                    </div>
                  )}
                  {inspectedDetail.content_revision && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Content Revision (SHA-256): </span>
                      <span className="font-mono text-[11px] break-all">{inspectedDetail.content_revision}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Compatibility: </span>
                    <Badge
                      variant={inspectedDetail.compatibility === "native" ? "success" : "destructive"}
                      className="text-[10px]"
                    >
                      {inspectedDetail.compatibility}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Eligibility: </span>
                    <Badge variant="outline" className="text-[10px]">
                      {inspectedDetail.eligibility}
                    </Badge>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <h3 className="font-semibold text-foreground mb-1">Description</h3>
                  <p className="text-muted-foreground bg-muted/10 p-2 rounded border border-border/40">
                    {inspectedDetail.description}
                  </p>
                </div>

                {/* Tools */}
                <div>
                  <h3 className="font-semibold text-foreground mb-1">Tool Declarations</h3>
                  <div className="space-y-1">
                    <div>
                      <span className="text-muted-foreground">Required: </span>
                      <span className="font-mono">
                        {inspectedDetail.required_tools?.length ? inspectedDetail.required_tools.join(", ") : "none"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Optional: </span>
                      <span className="font-mono">
                        {inspectedDetail.optional_tools?.length ? inspectedDetail.optional_tools.join(", ") : "none"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Resources */}
                {inspectedDetail.resources && inspectedDetail.resources.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Package Resources ({inspectedDetail.resources.length})</h3>
                    <div className="space-y-1 max-h-32 overflow-y-auto rounded border border-border/40 p-1.5">
                      {inspectedDetail.resources.map((res) => (
                        <div key={res.path} className="flex items-center justify-between py-0.5">
                          <span className="font-mono text-[11px]">{res.path} ({res.size} bytes)</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => void handleInspectResource(res.path)}
                            disabled={inspectResourceLoading}
                          >
                            Preview
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Resource text preview */}
                {inspectResource && (
                  <div className="rounded border border-border bg-muted/30 p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold">{inspectResource.path}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {inspectResource.size} bytes {inspectResource.truncated ? "(truncated)" : ""}
                      </span>
                    </div>
                    <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-[11px] border border-border/50">
                      {inspectResource.content}
                    </pre>
                  </div>
                )}

                {/* System Prompt Template */}
                {inspectedDetail.system_prompt && (
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">System Prompt Guidance</h3>
                    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border/60 bg-muted/10 p-2 font-mono text-[11px]">
                      {inspectedDetail.system_prompt}
                    </pre>
                  </div>
                )}

                {/* Local Consent / Enable action */}
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <div className="text-muted-foreground">
                    Current runtime: {inspectedDetail.enabled ? "Enabled" : "Disabled"}
                  </div>
                  <div className="flex gap-2">
                    {(!inspectedDetail.enabled || inspectedDetail.eligibility === "inspection_required") && (
                      <Button
                        onClick={() => void handleEnableFromInspection()}
                        disabled={mutating || inspectedDetail.compatibility === "needs_adaptation"}
                        title={
                          inspectedDetail.compatibility === "needs_adaptation"
                            ? "Incompatible foreign skill cannot be enabled"
                            : "Enable this exact inspected revision for the current runtime"
                        }
                      >
                        {inspectedDetail.eligibility === "inspection_required"
                          ? "Re-consent inspected revision"
                          : "Enable for this runtime"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => {
                        setInspectedDetail(null);
                        setInspectResource(null);
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Global Replace Confirmation Modal */}
      {replacingSkill && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="replace-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="relative flex w-full max-w-md flex-col rounded-lg border border-border bg-card p-6 shadow-xl space-y-4">
            <h2 id="replace-modal-title" className="text-base font-semibold">
              Replace Package: {replacingSkill.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              Replacing this package will update the shared HOME library for all daemons and CLI sessions.
              Because instructions will change, the new revision will require explicit re-inspection and consent before it can be used.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReplacingSkill(null)}
                disabled={mutating}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => replaceFileInputRef.current?.click()}
                disabled={mutating}
              >
                Choose replacement file (.skill/.zip)
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Global Uninstall Modal */}
      {uninstallingSkill && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="uninstall-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="relative flex w-full max-w-md flex-col rounded-lg border border-destructive/40 bg-card p-6 shadow-xl space-y-4">
            <h2 id="uninstall-modal-title" className="text-base font-semibold text-destructive">
              Uninstall from shared HOME library
            </h2>
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                Are you sure you want to uninstall <strong className="text-foreground">{uninstallingSkill.name}</strong>?
              </p>
              <div className="rounded border border-destructive/30 bg-destructive/10 p-2.5 text-destructive text-[11px]">
                <p className="font-semibold mb-1">Impact Warning:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>This removes the skill from the central shared skills library.</li>
                  <li>All projects, daemons, and CLI sessions under this OS account will lose access to this skill.</li>
                  <li>Already admitted execution turns may finish; native renderer, bundled skills, and run history remain intact.</li>
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUninstallingSkill(null)}
                disabled={mutating}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleConfirmUninstall()}
                disabled={mutating}
              >
                Uninstall globally
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
SkillBrowser.displayName = "SkillBrowser";
