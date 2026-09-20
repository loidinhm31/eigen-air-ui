// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserQuestionCard, type UserQuestionCardProps } from "./UserQuestionCard.js";

afterEach(cleanup);

const shortTextQuestion = {
  kind: "short_text",
  prompt: "What should the note say?",
  help: "Use a short plain-text response.",
} as const;

function baseProps(overrides: Partial<UserQuestionCardProps> = {}): UserQuestionCardProps {
  return {
    question: shortTextQuestion,
    draft: "ready",
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("UserQuestionCard", () => {
  it("renders the G3 boundary copy and accessible labels for choices", () => {
    render(
      <UserQuestionCard
        {...baseProps({
          question: {
            kind: "single_choice",
            prompt: "Choose a response style",
            options: [
              { id: "brief", label: "Brief" },
              { id: "detailed", label: "Detailed" },
            ],
          },
          draft: "brief",
        })}
      />
    );

    expect(screen.getByRole("heading", { name: "Agent question" })).toBeTruthy();
    expect(screen.getByText("Input only — does not authorize actions.")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Choose a response style" })).toBeTruthy();
    expect(screen.getByLabelText("Brief")).toBeTruthy();
    expect(screen.getByLabelText("Detailed")).toBeTruthy();
  });

  it("submits a short-text draft when Enter uses the native form", async () => {
    const onSubmit = vi.fn();
    render(<UserQuestionCard {...baseProps({ onSubmit })} />);

    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: shortTextQuestion.prompt });
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith("ready");
  });

  it("keeps Enter as a newline in multiline input and Escape does not cancel", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    function ControlledMultilineCard() {
      const [draft, setDraft] = React.useState("");
      return (
        <UserQuestionCard
          question={{ kind: "multiline", prompt: "Add context" }}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );
    }

    render(<ControlledMultilineCard />);
    const user = userEvent.setup();
    const textarea = screen.getByRole("textbox", { name: "Add context" });

    await user.type(textarea, "first line");
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");

    expect((textarea as HTMLTextAreaElement).value).toBe("first line\n");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders hostile prompt text as inert React text", () => {
    const hostile = '<img src=x onerror="alert(1)"><strong>literal</strong>';
    const { container } = render(
      <UserQuestionCard
        {...baseProps({
          question: {
            kind: "short_text",
            prompt: hostile,
            help: hostile,
          },
          error: hostile,
          status: hostile,
        })}
      />
    );

    expect(container.textContent).toContain(hostile);
    expect(container.querySelector("img, strong, script, svg")).toBeNull();
  });

  it("fails closed for an unknown kind with read-only content and no submit", () => {
    const onSubmit = vi.fn();
    render(
      <UserQuestionCard
        {...baseProps({
          question: { kind: "future_kind", prompt: "A newer question shape" },
          onSubmit,
        })}
      />
    );

    expect(screen.getByText("This question type is not supported.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Unsupported question type.");
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("only takes focus when requested and exposes busy/status/error state", () => {
    const { container } = render(
      <UserQuestionCard
        {...baseProps({
          loading: true,
          focus: true,
          status: "Agent is working",
          error: "The response could not be sent.",
        })}
      />
    );

    const input = screen.getByRole("textbox", { name: shortTextQuestion.prompt });
    const article = container.querySelector("article");
    expect(document.activeElement).not.toBe(input);
    expect(article?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Agent is working");
    expect(screen.getByRole("status").querySelector("svg.animate-spin")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("could not be sent");
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).not.toMatch(/\b(?:approve|approval|allow|deny|shield)\b/i);
  });

  it("focuses the first native control only when focus is enabled", () => {
    const first = render(<UserQuestionCard {...baseProps({ focus: false })} />);
    const input = screen.getByRole("textbox", { name: shortTextQuestion.prompt });
    expect(document.activeElement).not.toBe(input);
    first.unmount();

    render(<UserQuestionCard {...baseProps({ focus: true })} />);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: shortTextQuestion.prompt })
    );
  });
});
