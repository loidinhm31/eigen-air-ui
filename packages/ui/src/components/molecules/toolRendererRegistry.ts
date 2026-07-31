import * as React from "react";

const h = React.createElement;
const MAX_SERIALIZATION_DEPTH = 20;
const MAX_ITEMS_PER_CONTAINER = 100;

export const TOOL_DISPLAY_LIMITS = { args: 32 * 1024, result: 64 * 1024 } as const;

export interface ToolRendererProps {
  call: unknown;
  result?: unknown;
}

export type ToolRenderer = (props: ToolRendererProps) => React.ReactNode;

// Intentionally closed: tool names never select executable or remotely loaded UI.
export const toolRendererRegistry: Readonly<Record<string, ToolRenderer>> = Object.freeze(
  Object.create(null) as Record<string, ToolRenderer>
);

export function resolveToolRenderer(name: unknown): ToolRenderer {
  return typeof name === "string" && Object.hasOwn(toolRendererRegistry, name)
    ? toolRendererRegistry[name]!
    : GenericToolRenderer;
}

export function toolName(call: unknown): string | undefined {
  const name = field(call, "name");
  return typeof name === "string" ? name : undefined;
}

function field(value: unknown, key: string): unknown {
  try {
    return value && typeof value === "object" ? Reflect.get(value, key) : undefined;
  } catch {
    return undefined;
  }
}

class BoundedWriter {
  private readonly chunks: string[] = [];
  private bytes = 0;
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  write(value: string): boolean {
    for (const char of value) {
      const point = char.codePointAt(0) ?? 0;
      const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (this.bytes + size > this.maxBytes) {
        this.truncated = true;
        return false;
      }
      this.chunks.push(char);
      this.bytes += size;
    }
    return true;
  }

  finish() {
    return { text: this.chunks.join(""), truncated: this.truncated };
  }
}

function serializeBounded(value: unknown, maxBytes: number) {
  const writer = new BoundedWriter(maxBytes);
  writeValue(value, writer, new WeakSet<object>(), 0);
  return writer.finish();
}

function writeValue(value: unknown, writer: BoundedWriter, seen: WeakSet<object>, depth: number) {
  if (writer.truncated) return;
  if (depth > MAX_SERIALIZATION_DEPTH) return void writeString("[Max depth]", writer);
  if (value === null) return void writer.write("null");
  if (typeof value === "string") return void writeString(value, writer);
  if (typeof value === "boolean") return void writer.write(String(value));
  if (typeof value === "number")
    return void writer.write(Number.isFinite(value) ? String(value) : "null");
  if (typeof value === "bigint") return void writeString("[BigInt]", writer);
  if (typeof value !== "object") return void writeString("[Unsupported value]", writer);
  if (seen.has(value)) return void writeString("[Circular]", writer);

  seen.add(value);
  try {
    if (value instanceof Error) return void writeString("[Error]", writer);
    if (Array.isArray(value)) {
      writer.write("[");
      const length = value.length;
      for (let index = 0; index < Math.min(length, MAX_ITEMS_PER_CONTAINER); index += 1) {
        if (index > 0) writer.write(", ");
        writeValue(field(value, String(index)), writer, seen, depth + 1);
        if (writer.truncated) break;
      }
      if (length > MAX_ITEMS_PER_CONTAINER && !writer.truncated) writer.truncated = true;
      writer.write("]");
      return;
    }

    writer.write("{");
    let itemCount = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (itemCount === MAX_ITEMS_PER_CONTAINER) {
        writer.truncated = true;
        break;
      }
      if (itemCount > 0) writer.write(", ");
      itemCount += 1;
      writeString(key, writer);
      writer.write(": ");
      writeValue(field(value, key), writer, seen, depth + 1);
      if (writer.truncated) break;
    }
    writer.write("}");
  } catch {
    writeString("[Unserializable value]", writer);
  } finally {
    seen.delete(value);
  }
}

function writeString(value: string, writer: BoundedWriter) {
  if (!writer.write('"')) return;
  for (const char of value) {
    const escaped = char === '"' ? '\\"' : char === "\\" ? "\\\\" : char === "\n" ? "\\n" : char;
    if (!writer.write(escaped)) return;
  }
  writer.write('"');
}

function Display({ label, shown }: { label: string; shown: ReturnType<typeof serializeBounded> }) {
  return h(
    "div",
    null,
    h("span", { className: "text-muted-foreground" }, `${label}: `),
    h("pre", { className: "mt-1 overflow-x-auto whitespace-pre-wrap text-foreground" }, shown.text),
    shown.truncated &&
      h("p", { className: "text-muted-foreground italic" }, `${label} truncated for display`)
  );
}

function resultDisplay(value: string) {
  const shown = serializeText(value, TOOL_DISPLAY_LIMITS.result);
  if (shown.truncated) return h(Display, { label: "result (unparsed text)", shown });
  try {
    return h(Display, {
      label: "result",
      shown: serializeBounded(JSON.parse(shown.text), TOOL_DISPLAY_LIMITS.result),
    });
  } catch {
    return h(Display, { label: "result (unparsed text)", shown });
  }
}

function serializeText(value: string, maxBytes: number) {
  const writer = new BoundedWriter(maxBytes);
  writer.write(value);
  return writer.finish();
}

export function GenericToolRenderer({ call, result }: ToolRendererProps) {
  const callId = field(call, "id");
  const args = field(call, "args");
  const resultId = field(result, "id");
  const rawResult = field(result, "result");
  const resultReceived = result !== undefined;

  return h(
    "div",
    { className: "space-y-2", "data-testid": "generic-tool-renderer" },
    h(
      "p",
      { className: "text-muted-foreground" },
      `call id: ${typeof callId === "string" ? callId : "unavailable"}`
    ),
    h(Display, {
      label: "args",
      shown: serializeBounded(
        args === undefined ? "[unavailable]" : args,
        TOOL_DISPLAY_LIMITS.args
      ),
    }),
    !resultReceived && h("p", { className: "text-muted-foreground italic" }, "running..."),
    resultReceived &&
      typeof rawResult !== "string" &&
      h(
        "p",
        { className: "text-muted-foreground italic" },
        `result unavailable (malformed payload)${resultId ? `: ${serializeBounded(resultId, 256).text}` : ""}`
      ),
    typeof rawResult === "string" && resultDisplay(rawResult)
  );
}
