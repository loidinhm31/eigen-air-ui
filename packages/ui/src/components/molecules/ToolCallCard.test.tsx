// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolCallCard } from "./ToolCallCard.js";

describe("ToolCallCard", () => {
  it("keeps its keyboard disclosure and call/result identity", async () => {
    render(
      <ToolCallCard
        call={{ id: "call-1", name: "shell", args: { command: "pwd" } }}
        result={{ id: "call-1", name: "shell", result: "ok" }}
      />
    );
    const button = screen.getByRole("button");
    const user = userEvent.setup();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("call id: call-1")).toBeTruthy();
    expect(screen.getByText("result (unparsed text):")).toBeTruthy();
    await user.keyboard(" ");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a malformed call without throwing", async () => {
    render(<ToolCallCard call={null as never} result={null as never} />);
    const button = screen.getByRole("button", { name: "unknown tool" });
    await userEvent.setup().click(button);
    expect(screen.getByText("call id: unavailable")).toBeTruthy();
  });
});
