// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import type * as PreviewLoader from "../../stores/image-preview-loader.js";
import type { ArtifactBlobLease } from "../../stores/artifact-blob-cache.js";
import { downloadImageArtifact } from "../../stores/image-download.js";
import { useImageArtifactStore } from "../../stores/image-artifact-store.js";
import { registerImagePreview } from "../../stores/image-lease-driver.js";
import {
  ImagePreviewError,
  isLeaseUsable,
  loadImagePreview,
  type LoadImagePreviewOptions,
} from "../../stores/image-preview-loader.js";
import type { ImageRunGroup } from "../../stores/image-run-groups.js";
import { ChatImageAttachment } from "./ChatImageAttachment.js";
import { ChatImageRunGroup } from "./ChatImageRunGroup.js";

vi.mock("../../stores/image-preview-loader.js", async (importActual) => ({
  ...(await importActual<typeof PreviewLoader>()),
  loadImagePreview: vi.fn(),
  isLeaseUsable: vi.fn(),
}));
vi.mock("../../stores/image-lease-driver.js", () => ({ registerImagePreview: vi.fn() }));
vi.mock("../../stores/image-download.js", () => ({ downloadImageArtifact: vi.fn() }));

const load = vi.mocked(loadImagePreview);
const usable = vi.mocked(isLeaseUsable);
const register = vi.mocked(registerImagePreview);
const download = vi.mocked(downloadImageArtifact);
let unregister: Mock = vi.fn();

function artifact(overrides: Partial<ImageArtifactRef> = {}): ImageArtifactRef {
  return {
    schema: "image_artifact.v1",
    artifact_id: "art-1",
    job_id: "job-1",
    session_id: "s1",
    run_id: "r1",
    ordinal: 0,
    mime: "image/png",
    width: 512,
    height: 256,
    byte_size: 1000,
    sha256: "0".repeat(64),
    created_at_ms: 1,
    state: "committed",
    ...overrides,
  };
}

interface FakeLease {
  lease: ArtifactBlobLease;
  release: Mock;
  revoke(): void;
}

function fakeLease(url: string): FakeLease {
  let revoked = false;
  const callbacks = new Set<() => void>();
  const release = vi.fn();
  const lease: ArtifactBlobLease = {
    key: `key-${url}`,
    url,
    get revoked() {
      return revoked;
    },
    onRevoked(callback) {
      if (revoked) {
        callback();
        return () => undefined;
      }
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    release,
  };
  return {
    lease,
    release,
    revoke() {
      revoked = true;
      callbacks.forEach((callback) => callback());
    },
  };
}

function setStamp(stamp: number) {
  act(() => {
    useImageArtifactStore.setState({ listingStamps: { r1: stamp } });
  });
}

beforeEach(() => {
  unregister = vi.fn();
  register.mockReturnValue(unregister);
  usable.mockImplementation((lease) => !lease.revoked);
  useImageArtifactStore.setState({ activeSessionId: "s1", listingStamps: { r1: 1 } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useImageArtifactStore.setState({ activeSessionId: null, listingStamps: {} });
});

describe("ChatImageAttachment", () => {
  it("shows a busy skeleton, then the image with a prompt-free alt text and a registered preview", async () => {
    const fake = fakeLease("blob:one");
    load.mockResolvedValue(fake.lease);
    render(<ChatImageAttachment artifact={artifact()} index={0} count={2} />);

    expect(screen.getByRole("status").textContent).toBe("Loading image");
    expect(
      screen.getByRole("figure", { name: "Generated image 1 of 2" }).getAttribute("aria-busy")
    ).toBe("true");

    const img = await screen.findByRole("img", { name: "Generated image 1 of 2" });
    expect(img.getAttribute("src")).toBe("blob:one");
    expect(screen.getByRole("figure").getAttribute("aria-busy")).toBe("false");
    expect(load).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("s1");
  });

  it("aborts the load, releases the lease and unregisters the preview on unmount", async () => {
    const fake = fakeLease("blob:one");
    load.mockResolvedValue(fake.lease);
    const { unmount } = render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
    await screen.findByRole("img");
    const signal = load.mock.calls[0]?.[1]?.signal;

    unmount();
    expect(signal?.aborted).toBe(true);
    expect(fake.release).toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
  });

  it("never shows a load that settles after unmount", async () => {
    const fake = fakeLease("blob:late");
    let resolve!: (lease: ArtifactBlobLease) => void;
    load.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
    unmount();
    await act(async () => resolve(fake.lease));
    expect(fake.release).toHaveBeenCalled();
  });

  it.each(["unavailable", "deleted"] as const)(
    "renders an uncommitted (%s) artifact as unavailable without any load or download",
    (state) => {
      render(<ChatImageAttachment artifact={artifact({ state })} index={0} count={1} />);
      expect(screen.getByText("This image is unavailable.")).toBeTruthy();
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(load).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    }
  );

  it("replaces the image with an expired state when the lease is revoked, and Reload loads again", async () => {
    const first = fakeLease("blob:one");
    const second = fakeLease("blob:two");
    load.mockResolvedValueOnce(first.lease).mockResolvedValueOnce(second.lease);
    const user = userEvent.setup();
    render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
    await screen.findByRole("img");

    act(() => first.revoke());
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("This image preview expired.")).toBeTruthy();
    expect(first.release).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect((await screen.findByRole("img")).getAttribute("src")).toBe("blob:two");
  });

  it("never renders an image whose lease stopped being usable before the revoke event", async () => {
    const fake = fakeLease("blob:one");
    load.mockResolvedValue(fake.lease);
    const { rerender } = render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
    await screen.findByRole("img");

    usable.mockReturnValue(false);
    rerender(<ChatImageAttachment artifact={artifact({ created_at_ms: 2 })} index={0} count={1} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("This image preview expired.")).toBeTruthy();
  });

  it("does not reload when later listings renew the stamp of a displayed image", async () => {
    load.mockResolvedValue(fakeLease("blob:one").lease);
    render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
    await screen.findByRole("img");

    setStamp(2);
    setStamp(3);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  describe("authorization_stale", () => {
    const stale = () => new ImagePreviewError("authorization_stale");

    it("waits for a newer listing stamp (no timer/loop) and then retries", async () => {
      load.mockRejectedValueOnce(stale()).mockResolvedValueOnce(fakeLease("blob:fresh").lease);
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);

      expect(await screen.findByText("Refreshing image access…")).toBeTruthy();
      await act(async () => undefined);
      expect(load).toHaveBeenCalledTimes(1);

      setStamp(2);
      expect((await screen.findByRole("img")).getAttribute("src")).toBe("blob:fresh");
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("gives up after two automatic retries and then needs a manual Reload", async () => {
      load.mockRejectedValue(stale());
      const user = userEvent.setup();
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);

      await screen.findByText("Refreshing image access…");
      setStamp(2);
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      await screen.findByText("Refreshing image access…");
      setStamp(3);
      await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
      await screen.findByText("This image preview expired.");

      setStamp(4);
      setStamp(5);
      await act(async () => undefined);
      expect(load).toHaveBeenCalledTimes(3);

      await user.click(screen.getByRole("button", { name: "Reload" }));
      await waitFor(() => expect(load).toHaveBeenCalledTimes(4));
    });
  });

  describe("load failures show fixed text", () => {
    it.each([
      ["denied", "This image is no longer available.", false],
      ["unavailable", "This image is unavailable.", false],
      ["busy", "The image service is busy. Try again in a moment.", true],
      ["capacity", "Preview capacity reached. It loads when other previews are released.", true],
      ["failed", "The image could not be loaded.", true],
    ] as const)("%s", async (code, text, hasReload) => {
      load.mockRejectedValue(new ImagePreviewError(code));
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.queryByRole("button", { name: "Reload" }) !== null).toBe(hasReload);
    });

    it("explains the insecure-context (unsupported) case", async () => {
      load.mockRejectedValue(new ImagePreviewError("unsupported"));
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      expect(await screen.findByText(/not supported in this browser context/)).toBeTruthy();
    });

    it("never echoes an unexpected error message", async () => {
      load.mockRejectedValue(new Error("secret prompt text"));
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      expect(await screen.findByText("The image could not be loaded.")).toBeTruthy();
      expect(document.body.textContent).not.toContain("secret");
    });
  });

  describe("waiting for a free preview slot (queued)", () => {
    /** A loader that starts queued and is admitted/finished by the test. */
    function queuedLoader() {
      const control = {} as {
        options: LoadImagePreviewOptions;
        finish: (lease: ArtifactBlobLease) => void;
      };
      load.mockImplementation((_artifact, options) => {
        control.options = options ?? {};
        options?.onQueueChange?.(true);
        return new Promise<ArtifactBlobLease>((resolve) => (control.finish = resolve));
      });
      return control;
    }

    it("shows the fixed capacity notice without Reload, then renders on its own once admitted", async () => {
      const control = queuedLoader();
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);

      expect(
        await screen.findByText(
          "Preview capacity reached. It loads when other previews are released."
        )
      ).toBeTruthy();
      expect(screen.getByRole("status")).toBeTruthy();
      // Reload would only cancel the queue position: not offered while waiting.
      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
      expect(screen.getByRole("figure").getAttribute("aria-busy")).toBe("false");

      act(() => control.options.onQueueChange?.(false));
      expect(screen.getByRole("status").textContent).toBe("Loading image");

      await act(async () => control.finish(fakeLease("blob:ok").lease));
      expect(screen.getByRole("img").getAttribute("src")).toBe("blob:ok");
      expect(screen.queryByText(/Preview capacity reached/)).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("aborts the queued load on unmount and ignores a late admission", async () => {
      const control = queuedLoader();
      const { unmount } = render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      await screen.findByText(/Preview capacity reached/);
      const signal = control.options.signal;
      unmount();
      expect(signal?.aborted).toBe(true);

      const late = fakeLease("blob:late");
      await act(async () => control.finish(late.lease));
      expect(late.release).toHaveBeenCalledTimes(1);
    });

    it("drops the queued notice when the image leaves the viewport", async () => {
      const control = queuedLoader();
      const { rerender } = render(
        <ChatImageAttachment artifact={artifact()} index={0} count={1} />
      );
      await screen.findByText(/Preview capacity reached/);
      const signal = control.options.signal;
      // A different artifact id restarts the effect exactly like leaving/re-entering the viewport.
      rerender(
        <ChatImageAttachment artifact={artifact({ artifact_id: "art-2" })} index={0} count={1} />
      );
      expect(signal?.aborted).toBe(true);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe("cache-level capacity failure", () => {
    it("shows the notice with a manual Reload and never retries on its own", async () => {
      load.mockRejectedValue(new ImagePreviewError("capacity"));
      const user = userEvent.setup();
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      await screen.findByText(/Preview capacity reached/);
      await act(async () => undefined);
      setStamp(2);
      await act(async () => undefined);
      expect(load).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Reload" }));
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    });
  });

  describe("accessibility", () => {
    it("names the figure only while no image is shown (the <img alt> names it otherwise)", async () => {
      load.mockResolvedValue(fakeLease("blob:one").lease);
      render(<ChatImageAttachment artifact={artifact()} index={0} count={2} />);
      expect(screen.getByRole("figure").getAttribute("aria-label")).toBe("Generated image 1 of 2");
      await screen.findByRole("img", { name: "Generated image 1 of 2" });
      expect(screen.getByRole("figure").hasAttribute("aria-label")).toBe(false);
    });

    it("announces a revoked preview as a status and a failed load as an alert", async () => {
      const fake = fakeLease("blob:one");
      load.mockResolvedValueOnce(fake.lease);
      const { unmount } = render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      await screen.findByRole("img");
      act(() => fake.revoke());
      expect(screen.getByRole("status").textContent).toContain("This image preview expired.");
      unmount();

      load.mockRejectedValue(new ImagePreviewError("failed"));
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      expect((await screen.findByRole("alert")).textContent).toContain(
        "The image could not be loaded."
      );
    });

    it("keeps keyboard focus inside the figure when Reload is activated", async () => {
      load
        .mockRejectedValueOnce(new ImagePreviewError("failed"))
        .mockReturnValueOnce(new Promise(() => undefined));
      const user = userEvent.setup();
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      const reload = await screen.findByRole("button", { name: "Reload" });
      reload.focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));

      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("figure"));
    });

    it("after Reload succeeds, focus rests on the figure (the preview), not <body>", async () => {
      load
        .mockRejectedValueOnce(new ImagePreviewError("failed"))
        .mockResolvedValueOnce(fakeLease("blob:ok").lease);
      const user = userEvent.setup();
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      (await screen.findByRole("button", { name: "Reload" })).focus();
      await user.keyboard("{Enter}");

      await screen.findByRole("img");
      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("figure"));
    });

    it("leaves focus alone when it is outside the attachment (e.g. the chat input)", async () => {
      load
        .mockRejectedValueOnce(new ImagePreviewError("failed"))
        .mockResolvedValueOnce(fakeLease("blob:ok").lease);
      render(
        <>
          <input aria-label="Chat input" />
          <ChatImageAttachment artifact={artifact()} index={0} count={1} />
        </>
      );
      const reload = await screen.findByRole("button", { name: "Reload" });
      const input = screen.getByLabelText("Chat input");
      input.focus();
      fireEvent.click(reload); // activated without moving focus (e.g. by assistive tech)

      await screen.findByRole("img");
      expect(document.activeElement).toBe(input);
    });
  });

  describe("download", () => {
    it("is a keyboard-operable button that stays focused and aria-busy/aria-disabled while running", async () => {
      load.mockResolvedValue(fakeLease("blob:one").lease);
      let finish!: () => void;
      download.mockReturnValue(new Promise<void>((r) => (finish = r)));
      const user = userEvent.setup();
      const art = artifact();
      render(<ChatImageAttachment artifact={art} index={1} count={3} />);
      await screen.findByRole("img");

      await user.tab();
      const button = screen.getByRole("button", { name: "Download image 2 of 3" });
      expect(document.activeElement).toBe(button);
      await user.keyboard("{Enter}");

      expect(download).toHaveBeenCalledTimes(1);
      expect(download.mock.calls[0]?.[0]).toEqual(art);
      // aria-disabled (not `disabled`): the button keeps keyboard focus while the download runs.
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(button);
      await user.keyboard("{Enter}");
      expect(download).toHaveBeenCalledTimes(1);
      expect(button.getAttribute("aria-busy")).toBe("true");

      await act(async () => finish());
      expect(button.getAttribute("aria-disabled")).toBe("false");
      expect(button.getAttribute("aria-busy")).toBe("false");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows a fixed-text alert on failure and never echoes the error", async () => {
      load.mockResolvedValue(fakeLease("blob:one").lease);
      download.mockRejectedValueOnce(new Error("secret prompt text"));
      const user = userEvent.setup();
      render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      await screen.findByRole("img");

      await user.click(screen.getByRole("button", { name: "Download image 1 of 1" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Download failed. Try again.");

      download.mockRejectedValueOnce(new ImagePreviewError("busy"));
      await user.click(screen.getByRole("button", { name: "Download image 1 of 1" }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "Download failed: the image service is busy. Try again in a moment."
        )
      );
    });

    it("aborts a running download on unmount", async () => {
      load.mockResolvedValue(fakeLease("blob:one").lease);
      download.mockReturnValue(new Promise<void>(() => undefined));
      const user = userEvent.setup();
      const { unmount } = render(<ChatImageAttachment artifact={artifact()} index={0} count={1} />);
      await screen.findByRole("img");
      await user.click(screen.getByRole("button", { name: "Download image 1 of 1" }));
      const signal = download.mock.calls[0]?.[1]?.signal;
      unmount();
      expect(signal?.aborted).toBe(true);
    });
  });
});

describe("ChatImageRunGroup", () => {
  function group(count: number): ImageRunGroup {
    const items = Array.from({ length: count }, (_, i) =>
      artifact({ artifact_id: `art-${i + 1}`, ordinal: i })
    );
    return { runId: "r1", sessionId: "s1", items, jobIds: ["job-1"], toolCallIds: [] };
  }

  it("renders one attachment per item, numbered in a default-labelled group (not a landmark)", async () => {
    load.mockImplementation(async (art) => fakeLease(`blob:${art.artifact_id}`).lease);
    render(<ChatImageRunGroup group={group(2)} />);

    expect(screen.getByRole("group", { name: "Generated images" })).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    const second = await screen.findByRole("img", { name: "Generated image 2 of 2" });
    expect(second.getAttribute("src")).toBe("blob:art-2");
    expect(screen.getByRole("img", { name: "Generated image 1 of 2" }).getAttribute("src")).toBe(
      "blob:art-1"
    );
  });

  it("shows the given label for unbound groups without inventing a message", () => {
    load.mockReturnValue(new Promise(() => undefined));
    render(<ChatImageRunGroup group={group(1)} label="Images from run abcd1234" />);
    expect(screen.getByRole("group", { name: "Images from run abcd1234" })).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByText("Images from run abcd1234")).toBeTruthy();
  });

  it("gives bound groups unique accessible names through their run ordinal", () => {
    load.mockReturnValue(new Promise(() => undefined));
    render(
      <>
        <ChatImageRunGroup group={group(1)} ordinal={1} />
        <ChatImageRunGroup group={group(1)} ordinal={2} />
      </>
    );
    expect(screen.getByRole("group", { name: "Generated images, run 1" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Generated images, run 2" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Generated images" })).toBeNull();
  });
});
