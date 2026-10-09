import * as React from "react";

/** Minimal observer shape used by the hook (the real `IntersectionObserver` satisfies it). */
export interface ViewportObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export type ViewportObserverFactory = (
  onEntries: (entries: ReadonlyArray<{ isIntersecting: boolean }>) => void,
  options: { rootMargin: string }
) => ViewportObserver;

export interface UseInViewportOptions {
  /** Grows the viewport so content is ready slightly before it scrolls into view. */
  rootMargin?: string;
  /**
   * Observer factory; defaults to the global `IntersectionObserver`. When neither is available
   * (SSR, jsdom) the element counts as visible so nothing is ever withheld.
   */
  createObserver?: ViewportObserverFactory;
}

const DEFAULT_ROOT_MARGIN = "200px";
/** Stable identity (the hook's effect depends on it); the constructor is resolved per call. */
const globalObserverFactory: ViewportObserverFactory = (onEntries, options) =>
  new IntersectionObserver(onEntries, options);

function defaultFactory(): ViewportObserverFactory | undefined {
  return typeof IntersectionObserver === "undefined" ? undefined : globalObserverFactory;
}

/**
 * True while `ref`'s element intersects the (margin-extended) viewport. Used to hold expensive
 * resources (leased blob URLs) only for what can actually be seen.
 */
export function useInViewport(
  ref: React.RefObject<Element | null>,
  { rootMargin = DEFAULT_ROOT_MARGIN, createObserver }: UseInViewportOptions = {}
): boolean {
  const factory = createObserver ?? defaultFactory();
  // Without an observer there is nothing to wait for: report visible from the first render.
  const [visible, setVisible] = React.useState(factory === undefined);

  React.useEffect(() => {
    const element = ref.current;
    if (!factory || !element) return undefined;
    const observer = factory(
      (entries) => {
        // Entries are ordered by time: the last one is the current state.
        const latest = entries[entries.length - 1];
        if (latest) setVisible(latest.isIntersecting);
      },
      { rootMargin }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, factory, rootMargin]);

  return visible;
}
