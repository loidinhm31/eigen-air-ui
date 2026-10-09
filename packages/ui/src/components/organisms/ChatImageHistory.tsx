/**
 * Chat-side image surfaces, extracted from `ChatPanel` to keep it small.
 *
 * - `ChatImageHistory`: renders the message list and, directly after the assistant message whose
 *   canonical `run_id` equals an artifact run, that run's images. Runs without such a message
 *   (aborted/incomplete turn, direct-template run) render after the list as labelled run groups;
 *   no assistant message is ever fabricated. Images are authoritative only from the server
 *   listing (`image-artifact-store`); chat messages carry no attachment data.
 * - `ChatImageGenerateAction`: header button that toggles the direct-template panel, visible only
 *   when the gateway advertises image generation. Independent of chat provider readiness.
 *
 * The owner (`ChatPanel`) mounts the single `useImageHistorySync(sessionId)`; nothing here fetches.
 *
 * Recovery notices ("Check again", listing "Retry") unmount as soon as their recovery starts. If
 * the pressed button held focus, it moves on once the outcome is known (`useNoticeFocusHandoff`):
 * back to a reappearing notice, else to the Generate trigger / chat heading; focus that the user
 * moved elsewhere (e.g. the chat input) is never touched.
 *
 * The direct-template draft (prompt, settings) is kept in memory by `ChatImageGenerateAction`,
 * which survives the panel closing; it is dropped with the session and never persisted.
 *
 * Reading position: previews change height after load. Each image group is watched; when the
 * reader is at the bottom the view stays pinned to it (late images do not land below the fold),
 * otherwise nothing is scrolled: the browser's CSS scroll anchoring keeps the reading position, so
 * a reader who scrolled up is never pulled back to the newest content.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ImagePlus } from "lucide-react";
import type { ChatMessage } from "@eigen-air-ui/shared/types";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useImageArtifactStore } from "../../stores/image-artifact-store.js";
import {
  useImageCapabilities,
  useImageCapabilityCheck,
  useSessionImageGroups,
} from "../../stores/use-image-history.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ChatImageRunGroup } from "../molecules/ChatImageRunGroup.js";
import { DirectImageTemplateAction } from "../molecules/DirectImageTemplateAction.js";
import { useDirectImageDraft } from "../molecules/direct-image-request.js";
import {
  IMAGE_CAPABILITY_CHECK_LABEL,
  IMAGE_CAPABILITY_FAILED_MESSAGE,
  useNoticeFocusHandoff,
  useReportFocusLost,
  type NoticeFocusHandoff,
  type NoticePhase,
} from "../molecules/image-ui-messages.js";

export interface ChatImageHistoryProps {
  sessionId: string | null;
  /** Messages exactly as displayed (bound by index). */
  messages: readonly ChatMessage[];
  renderMessage(message: ChatMessage, index: number): ReactNode;
}

const RUN_LABEL_ID_CHARS = 8;
/** Distance from the bottom (px) that still counts as "reading the newest content". */
const NEAR_BOTTOM_PX = 64;

/** Radix `ScrollArea` viewport marker (the element that actually scrolls). */
const SCROLL_VIEWPORT_SELECTOR = "[data-radix-scroll-area-viewport]";

interface ReadingAnchor {
  watch(element: HTMLElement): () => void;
  dispose(): void;
}

/**
 * Pins the scroll viewport to the bottom when watched groups resize, but only while the reader
 * was at the bottom as of the last scroll event. Never scrolls otherwise.
 */
function createReadingAnchor(): ReadingAnchor {
  const watched = new Set<HTMLElement>();
  let viewport: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let pinned = true;

  const measure = () => {
    if (viewport) {
      pinned = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= NEAR_BOTTOM_PX;
    }
  };
  const stop = () => {
    observer?.disconnect();
    observer = null;
    viewport?.removeEventListener("scroll", measure);
    viewport = null;
  };

  return {
    watch(element) {
      if (typeof ResizeObserver === "undefined") return () => undefined;
      if (!viewport) {
        viewport = element.closest<HTMLElement>(SCROLL_VIEWPORT_SELECTOR);
        if (!viewport) return () => undefined;
        viewport.addEventListener("scroll", measure, { passive: true });
        observer = new ResizeObserver(() => {
          if (pinned && viewport) viewport.scrollTop = viewport.scrollHeight;
        });
      }
      measure();
      watched.add(element);
      observer?.observe(element);
      return () => {
        watched.delete(element);
        observer?.unobserve(element);
        if (watched.size === 0) stop();
      };
    },
    dispose() {
      watched.clear();
      stop();
    },
  };
}

type NoticeKind = "capability" | "listing";

/**
 * After a recovery succeeded and the notice (with the focused button) is gone: "Check again" hands
 * focus to the Generate trigger when generation is now advertised, else to the chat heading; a
 * listing "Retry" hands it to the chat heading (both owned by `ChatPanel`).
 */
function resolveHandoffTarget(kind: NoticeKind): HTMLElement | null {
  const heading = document.querySelector<HTMLElement>("[data-chat-heading]");
  if (kind === "listing") return heading;
  return document.querySelector<HTMLElement>("[data-image-generate-trigger]") ?? heading;
}

/** Failure notice with a recovery button; reports when it unmounts while holding focus. */
function RecoveryNotice({
  handoff,
  kind,
  children,
}: {
  handoff: NoticeFocusHandoff<NoticeKind>;
  kind: NoticeKind;
  children: ReactNode;
}) {
  const { onFocus } = useReportFocusLost(handoff, kind);
  return (
    <div
      ref={handoff.boxRef}
      onFocus={onFocus}
      className="text-muted-foreground flex items-center gap-2 px-4 py-1 text-xs"
    >
      {children}
    </div>
  );
}

/** Block wrapper (observable box) around one run group. */
function AnchoredGroup({ anchor, children }: { anchor: ReadingAnchor; children: ReactNode }) {
  const ref: RefObject<HTMLDivElement | null> = useRef(null);
  useEffect(() => (ref.current ? anchor.watch(ref.current) : undefined), [anchor]);
  return <div ref={ref}>{children}</div>;
}

export function ChatImageHistory({ sessionId, messages, renderMessage }: ChatImageHistoryProps) {
  const binding = useSessionImageGroups(messages);
  const connected = useConnectionStore((state) => state.status === "connected");
  const capabilities = useImageCapabilities();
  const check = useImageCapabilityCheck(sessionId);
  const status = useImageArtifactStore((state) => state.status);
  const owned = useImageArtifactStore((state) => state.activeSessionId === sessionId);
  const hasImages = useImageArtifactStore((state) => state.artifacts.length > 0);
  const [anchor] = useState(createReadingAnchor);
  useEffect(() => () => anchor.dispose(), [anchor]);
  // Never show another session's images for the frame before the hook switches the store.
  const bound = owned ? binding.bound : undefined;
  const unbound = owned ? binding.unbound : [];

  const failureKind: NoticeKind | null =
    sessionId && connected
      ? check.failed
        ? "capability"
        : capabilities.readers &&
            owned &&
            (status === "unavailable" || status === "error" || status === "stale")
          ? "listing"
          : null
      : null;
  const phase: NoticePhase =
    failureKind !== null
      ? "failed"
      : sessionId &&
          connected &&
          (capabilities.status !== "known" ||
            (capabilities.readers && (!owned || status === "idle" || status === "loading")))
        ? "busy"
        : "done";
  const handoff = useNoticeFocusHandoff<NoticeKind>(phase, sessionId, resolveHandoffTarget);

  let notice: ReactNode = null;
  if (failureKind === "capability") {
    // The capability read failed: availability is unknown, so say so (a gateway that simply
    // has no readers is `known` and stays silent). Generation stays hidden until known true.
    notice = (
      <RecoveryNotice handoff={handoff} kind="capability">
        <span role="status">{IMAGE_CAPABILITY_FAILED_MESSAGE}</span>
        <Button
          variant="outline"
          size="sm"
          aria-disabled={check.checking || undefined}
          aria-busy={check.checking || undefined}
          onClick={check.check}
        >
          {IMAGE_CAPABILITY_CHECK_LABEL}
        </Button>
      </RecoveryNotice>
    );
  } else if (failureKind === "listing") {
    notice = (
      <RecoveryNotice handoff={handoff} kind="listing">
        <span role="status">
          {status === "stale"
            ? "Image history could not be refreshed."
            : "Image history is unavailable."}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (sessionId) void useImageArtifactStore.getState().refreshSession(sessionId);
          }}
        >
          Retry
        </Button>
      </RecoveryNotice>
    );
  } else if (
    sessionId &&
    connected &&
    capabilities.readers &&
    (!owned || status === "idle" || status === "loading") &&
    // A refresh over an already shown list stays silent; first load shows progress.
    (!owned || !hasImages)
  ) {
    notice = (
      <div
        role="status"
        aria-busy="true"
        className="text-muted-foreground flex items-center gap-2 px-4 py-1 text-xs"
      >
        <Spinner size="sm" />
        Loading images…
      </div>
    );
  }

  // Several bound groups would all be named "Generated images": number them in reading order.
  let boundOrdinal = 0;
  return (
    <>
      {messages.map((message, index) => (
        <Fragment key={message.id ?? `${message.role}-${index}`}>
          {renderMessage(message, index)}
          {bound?.get(index)?.map((group) => (
            <AnchoredGroup key={group.runId} anchor={anchor}>
              <ChatImageRunGroup group={group} ordinal={++boundOrdinal} />
            </AnchoredGroup>
          ))}
        </Fragment>
      ))}
      {unbound.map((group) => (
        <AnchoredGroup key={group.runId} anchor={anchor}>
          <ChatImageRunGroup
            group={group}
            label={`Images from run ${group.runId.slice(0, RUN_LABEL_ID_CHARS)}`}
          />
        </AnchoredGroup>
      ))}
      {notice}
    </>
  );
}

export function ChatImageGenerateAction({ sessionId }: { sessionId: string | null }) {
  const generation = useImageCapabilities().generation;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const targetSessionId = generation ? sessionId : null;
  // The draft outlives the panel (Escape/Close unmount it) but not the session: memory only.
  const { draft, onDraftChange } = useDirectImageDraft(targetSessionId);

  // The panel belongs to one session and to an advertised capability: drop it when either goes.
  // (No focus move here: the user may be anywhere by then.)
  useEffect(() => {
    setOpen(false);
  }, [targetSessionId]);

  if (targetSessionId === null) return null;

  // Explicit close: restore the trigger only if focus is still inside the panel (or was dropped
  // to the body by the unmount); never steal it after the user moved elsewhere.
  const close = () => {
    const active = document.activeElement;
    const restore =
      active === null || active === document.body || !!panelRef.current?.contains(active);
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  };

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant={open ? "secondary" : "ghost"}
        size="sm"
        className="h-7 px-2 text-xs"
        aria-label="Generate image"
        aria-expanded={open}
        aria-controls={open ? "chat-direct-image-panel" : undefined}
        data-image-generate-trigger=""
        onClick={() => (open ? close() : setOpen(true))}
      >
        <ImagePlus size={13} aria-hidden="true" className="sm:mr-1" />
        <span className="hidden sm:inline">Image</span>
      </Button>
      {open && (
        <div
          ref={panelRef}
          id="chat-direct-image-panel"
          className="border-border bg-card absolute right-0 top-full z-30 mt-1 w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-md border shadow-lg"
        >
          <DirectImageTemplateAction
            sessionId={targetSessionId}
            onClose={close}
            draft={draft}
            onDraftChange={onDraftChange}
          />
        </div>
      )}
    </div>
  );
}
