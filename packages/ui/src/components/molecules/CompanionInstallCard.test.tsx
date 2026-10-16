// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionInstallCard } from "./CompanionInstallCard.js";

afterEach(() => {
  cleanup();
});

describe("CompanionInstallCard", () => {
  it("renders browser execution boundary and model weight exclusion note", () => {
    render(<CompanionInstallCard />);

    expect(
      screen.getByText(/browser does not execute native model weights or in-browser WebGPU/i)
    ).toBeDefined();
    expect(
      screen.getByText(/excludes model weights/i)
    ).toBeDefined();
  });

  it("renders all 4 supported platforms without fabricated links", () => {
    render(<CompanionInstallCard />);

    expect(screen.getAllByText("macOS").length).toBe(2);
    expect(screen.getByText(/Apple Silicon/i)).toBeDefined();
    expect(screen.getByText(/Intel/i)).toBeDefined();
    expect(screen.getByText("Linux")).toBeDefined();
    expect(screen.getAllByText(/x86_64/i).length).toBe(2);
    expect(screen.getByText("Windows")).toBeDefined();
    // Default renders "Available Soon" without fabricating links
    const badges = screen.getAllByText("Available Soon");
    expect(badges.length).toBe(4);
  });

  it("renders verified download link when downloadUrls provided", () => {
    const downloadUrls = {
      "macos-arm64": "https://downloads.example.com/companion-mac-arm64.tar.gz",
    };

    render(<CompanionInstallCard downloadUrls={downloadUrls} />);

    const link = screen.getByRole("link", { name: /download/i });
    expect(link.getAttribute("href")).toBe("https://downloads.example.com/companion-mac-arm64.tar.gz");
    expect(link.getAttribute("download")).toBe("");
  });

  it("triggers onDownload callback when download button clicked", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();

    render(<CompanionInstallCard onDownload={onDownload} />);

    const buttons = screen.getAllByRole("button", { name: /download/i });
    expect(buttons.length).toBe(4);

    await user.click(buttons[0]);
    expect(onDownload).toHaveBeenCalledWith("macos-arm64");
  });

  it("renders 4-step setup instructions and tab closure isolation explanation", () => {
    render(<CompanionInstallCard />);

    expect(screen.getByText(/Download & Run:/i)).toBeDefined();
    expect(screen.getByText(/Choose Storage:/i)).toBeDefined();
    expect(screen.getByText(/Copy Pairing Code:/i)).toBeDefined();
    expect(screen.getByText(/Approve in Browser:/i)).toBeDefined();

    expect(
      screen.getByText(/Closing or refreshing this browser tab does not terminate the running companion/i)
    ).toBeDefined();
  });
});
