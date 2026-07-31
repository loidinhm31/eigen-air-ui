import { describe, expect, it } from "vitest";
import { buildChatSendParams } from "./WsChatAdapter.js";

describe("buildChatSendParams", () => {
  it("omits selected_skill_id when no skill is selected", () => {
    expect(buildChatSendParams("hello", "session-1")).toEqual({
      message: "hello",
      stream: true,
      session_id: "session-1",
    });
  });

  it("passes through only the exact selected skill ID transport field", () => {
    const selectedSkillId = "x".repeat(256);

    expect(buildChatSendParams("ordinary message", undefined, { selectedSkillId })).toEqual({
      message: "ordinary message",
      stream: true,
      selected_skill_id: selectedSkillId,
    });
  });

  it("does not derive or serialize prompt and template keys", () => {
    const params = buildChatSendParams("review this", undefined, {
      selectedSkillId: "code_review",
    });

    expect(Object.keys(params)).toEqual(["message", "stream", "selected_skill_id"]);
    expect(params).not.toHaveProperty("selectedSkillId");
    expect(params).not.toHaveProperty("prompt");
    expect(params).not.toHaveProperty("template");
    expect(params).not.toHaveProperty("instructions");
  });
});
