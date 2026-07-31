// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown, MAX_MARKDOWN_BYTES } from "./AssistantMarkdown.js";
import { ChatBubble } from "./ChatBubble.js";

describe("AssistantMarkdown", () => {
  it("is used for assistant content only", () => {
    const { container } = render(
      <>
        <ChatBubble message={{ role: "system", content: "**system stays plain**" }} />
        <ChatBubble message={{ role: "user", content: "**user stays plain**" }} />
      </>
    );

    expect(container.querySelector("strong")).toBeNull();
    expect(screen.getByText("**system stays plain**")).not.toBeNull();
    expect(screen.getByText("**user stays plain**")).not.toBeNull();
  });

  it("renders the supported GFM features", () => {
    const { container } = render(
      <AssistantMarkdown
        content={
          "| Name | Value |\n| --- | --- |\n| API | `ready` |\n\n- [x] complete\n- [ ] pending\n\n~~retired~~ https://example.com\n\n```ts\nconst ready = true;\n```"
        }
      />
    );

    expect(screen.getByRole("table")).not.toBeNull();
    expect(
      screen.getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled"))
    ).toBe(true);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.querySelector("del")?.textContent).toBe("retired");
    expect(screen.getByRole("link", { name: "https://example.com" }).getAttribute("href")).toBe(
      "https://example.com"
    );
    expect(container.querySelector("pre")?.textContent).toContain("const ready = true;");
  });

  it("keeps raw HTML inert", () => {
    const { container } = render(
      <AssistantMarkdown content={'<script>alert("unsafe")</script><strong>plain text</strong>'} />
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(screen.getByText(/<strong>plain text<\/strong>/)).not.toBeNull();
  });

  it("does not render Markdown images", () => {
    const { container } = render(
      <AssistantMarkdown content="![untrusted image](https://example.com/image.png)" />
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("untrusted image")).not.toBeNull();
  });

  it("only makes absolute http(s) links navigable", () => {
    const { container } = render(
      <AssistantMarkdown content="[good](https://example.com/path) [relative](/docs) [protocol](//example.com) [mail](mailto:test@example.com) [javascript](javascript:alert(1)) [data](data:text/plain,nope) [file](file:///tmp/a) [blob](blob:https://example.com/id) [custom](custom:value)" />
    );

    const link = screen.getByRole("link", { name: "good" });
    expect(link.getAttribute("href")).toBe("https://example.com/path");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "relative" })).toBeNull();
    expect(screen.queryByRole("link", { name: "protocol" })).toBeNull();
    expect(screen.queryByRole("link", { name: "mail" })).toBeNull();
    expect(screen.queryByRole("link", { name: "javascript" })).toBeNull();
    expect(screen.queryByRole("link", { name: "data" })).toBeNull();
    expect(screen.queryByRole("link", { name: "file" })).toBeNull();
    expect(screen.queryByRole("link", { name: "blob" })).toBeNull();
    expect(screen.queryByRole("link", { name: "custom" })).toBeNull();
  });

  it("caps rendered input by UTF-8 bytes and announces truncation", () => {
    const { container } = render(
      <AssistantMarkdown content={`${"é".repeat(MAX_MARKDOWN_BYTES)}after`} />
    );

    expect(screen.getByRole("status").textContent).toBe(
      "Response truncated for display at 256 KB."
    );
    expect(container.textContent).not.toContain("after");
    expect(
      new TextEncoder().encode(
        container
          .querySelector("div")
          ?.textContent?.replace(/Response truncated for display at 256 KB\./, "") ?? ""
      ).byteLength
    ).toBeLessThanOrEqual(MAX_MARKDOWN_BYTES);
  });
});
