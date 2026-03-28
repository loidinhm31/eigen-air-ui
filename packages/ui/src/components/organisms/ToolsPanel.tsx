import * as React from "react";
import { useEffect, useState } from "react";
import { getToolService } from "../../adapters/factory/ServiceFactory.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { Button } from "../atoms/Button.js";
import { Input } from "../atoms/Input.js";
import { Spinner } from "../atoms/Spinner.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import type { Tool } from "@nonclaw-ui/shared/types";

export function ToolsPanel() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Tool | null>(null);
  const [argsJson, setArgsJson] = useState("{}");
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [invoking, setInvoking] = useState(false);

  useEffect(() => {
    setLoading(true);
    getToolService()
      .list()
      .then(setTools)
      .finally(() => setLoading(false));
  }, []);

  async function handleInvoke() {
    if (!selected) return;
    setInvoking(true);
    setInvokeResult(null);
    setInvokeError(null);
    try {
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      const result = await getToolService().invoke(selected.name, args);
      setInvokeResult(result.result);
    } catch (e) {
      setInvokeError(String(e));
    } finally {
      setInvoking(false);
    }
  }

  return (
    <div className="flex h-full gap-4 p-4">
      <div className="flex w-64 flex-col gap-2 shrink-0">
        <p className="text-sm font-medium text-muted-foreground">Tools ({tools.length})</p>
        {loading && <Spinner size="sm" />}
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1">
            {tools.map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  setSelected(t);
                  setArgsJson("{}");
                  setInvokeResult(null);
                  setInvokeError(null);
                }}
                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selected?.name === t.name
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <span className="font-mono block truncate">{t.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex flex-1 flex-col gap-3 min-w-0">
        {!selected ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Select a tool to invoke</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-sm">{selected.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{selected.description}</p>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2 text-xs">
                  {JSON.stringify(selected.parameters, null, 2)}
                </pre>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">Arguments (JSON)</label>
              <textarea
                value={argsJson}
                onChange={(e) => setArgsJson(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button onClick={() => void handleInvoke()} disabled={invoking} isLoading={invoking}>
                Invoke
              </Button>
            </div>

            {invokeResult !== null && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">Result</p>
                <pre className="whitespace-pre-wrap text-xs text-foreground">{invokeResult}</pre>
              </div>
            )}
            {invokeError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="text-xs text-destructive">{invokeError}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
ToolsPanel.displayName = "ToolsPanel";
