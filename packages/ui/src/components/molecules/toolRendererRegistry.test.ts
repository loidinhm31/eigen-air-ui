// @vitest-environment jsdom
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GenericToolRenderer,
  resolveToolRenderer,
  TOOL_DISPLAY_LIMITS,
  toolRendererRegistry,
} from "./toolRendererRegistry.js";

const h = React.createElement;

describe("tool renderer registry", () => {
  it("is immutable, exact, and always falls back to the generic renderer", () => {
    expect(Object.isFrozen(toolRendererRegistry)).toBe(true);
    expect(Reflect.set(toolRendererRegistry, "shell", GenericToolRenderer)).toBe(false);
    for (const name of ["shell", "SHELL", "toString", "constructor", "__proto__", undefined]) {
      expect(resolveToolRenderer(name)).toBe(GenericToolRenderer);
    }
  });

  it("renders malformed, missing, parsed, and unavailable results truthfully", () => {
    const { rerender } = render(h(GenericToolRenderer, { call: { id: "c", args: {} } }));
    expect(screen.getByText("running...")).toBeTruthy();
    rerender(h(GenericToolRenderer, { call: { id: "c", args: {} }, result: { result: 1 } }));
    expect(screen.getByText(/malformed payload/)).toBeTruthy();
    rerender(
      h(GenericToolRenderer, { call: { id: "c", args: {} }, result: { result: '{"ok":true}' } })
    );
    expect(screen.getByText("result:")).toBeTruthy();
    rerender(h(GenericToolRenderer, { call: { id: "c", args: {} }, result: null }));
    expect(screen.getByText(/malformed payload/)).toBeTruthy();
  });

  it("bounds multibyte data without splitting UTF-8 and handles circular values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let container: HTMLElement | undefined;
    expect(
      () =>
        ({ container } = render(
          h(GenericToolRenderer, {
            call: { id: "c", args: { circular, text: "界".repeat(20_000) } },
            result: { result: "界".repeat(30_000) },
          })
        ))
    ).not.toThrow();
    expect(screen.getByText("args truncated for display")).toBeTruthy();
    expect(screen.getByText("result (unparsed text) truncated for display")).toBeTruthy();
    const argsText = container?.querySelector("pre")?.textContent ?? "";
    const resultText = container?.querySelectorAll("pre")[1]?.textContent ?? "";
    expect(new TextEncoder().encode(argsText).byteLength).toBeLessThanOrEqual(
      TOOL_DISPLAY_LIMITS.args
    );
    expect(new TextEncoder().encode(resultText).byteLength).toBeLessThanOrEqual(
      TOOL_DISPLAY_LIMITS.result
    );
  });

  it("marks circular, BigInt, Error, and hostile nested values safely", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const broken = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no access");
        },
      }
    );
    let container: HTMLElement | undefined;
    expect(
      () =>
        ({ container } = render(
          h(GenericToolRenderer, {
            call: { args: { broken, big: 1n, circular, error: new Error("failed") } },
            result: broken,
          })
        ))
    ).not.toThrow();
    expect(container?.textContent).toContain("[BigInt]");
    expect(container?.textContent).toContain("[Circular]");
    expect(container?.textContent).toContain("[Error]");
    expect(container?.textContent).toContain("[Unserializable value]");
  });
});
