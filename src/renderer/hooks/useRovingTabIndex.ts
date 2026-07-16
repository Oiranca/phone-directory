import { useCallback } from "react";
import type { KeyboardEvent } from "react";

/**
 * Shared roving-tabindex / arrow-key navigation logic, extracted
 * from the near-identical implementations that used to live independently in
 * DirectoryPage.tsx (`handleListKeyDown`, list semantics) and
 * DeduplicatePage.tsx (`handleRadioGroupKeyDown`, radiogroup semantics).
 *
 * Both call sites share the same core: given an ordered list of item ids, a
 * keydown event fired on (or bubbled up to) the container, and the id of the
 * item that is the fallback "current" position, figure out which arrow key
 * was pressed, compute the wrapped previous/next index, and hand the newly
 * "current" item id back to the caller so it can update selection state and
 * move DOM focus however is appropriate for that page (each page keeps its
 * own focus/scroll strategy — this hook only owns the index arithmetic and
 * key-to-direction mapping, so neither page's existing keyboard behavior is
 * silently changed).
 */

export interface RovingTabIndexNavigationParams {
  /** Ordered ids of the navigable items. */
  itemIds: string[];
  /**
   * Id to fall back to when the keydown event's target cannot be matched to
   * one of `itemIds` (e.g. focus originated elsewhere, or the previously
   * focused id is no longer in the list). Pass `null`/`undefined` to fall
   * back straight to index 0 without an intermediate lookup.
   */
  fallbackId?: string | null;
  /** Called with the new "current" item id when an arrow/Home/End key moves it. */
  onNavigate: (id: string) => void;
  /**
   * Optional Enter key handler. Mirrors DirectoryPage's original behavior:
   * NOT preventDefault'd, so native button activation still proceeds.
   */
  onEnter?: (event: KeyboardEvent<HTMLElement>) => void;
  /** Optional Escape key handler. When provided, Escape is preventDefault'd. */
  onEscape?: (event: KeyboardEvent<HTMLElement>) => void;
  /** Attribute read off `event.target` to resolve the currently-focused item id. Default: "data-record-id". */
  dataAttribute?: string;
}

export interface UseRovingTabIndexOptions {
  /** Keys that move to the previous item. Default: ["ArrowUp"]. */
  previousKeys?: string[];
  /** Keys that move to the next item. Default: ["ArrowDown"]. */
  nextKeys?: string[];
  /** Whether Home/End jump to the first/last item. Default: false. */
  enableHomeEnd?: boolean;
}

/**
 * Returns a stable `handleKeyDown` function. It is intentionally NOT bound to
 * a specific set of item ids at the hook level — callers that render a
 * variable number of navigable groups per render (e.g. one radiogroup per
 * duplicate pair) can call the returned handler once per group inside a
 * `.map()`, passing that group's own `itemIds`/`onNavigate` at invocation
 * time, while still only calling the hook itself once, unconditionally, at
 * the top of the component (satisfying the rules of hooks).
 */
export function useRovingTabIndex(options: UseRovingTabIndexOptions = {}) {
  const { previousKeys = ["ArrowUp"], nextKeys = ["ArrowDown"], enableHomeEnd = false } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, params: RovingTabIndexNavigationParams) => {
      const { itemIds, fallbackId = null, onNavigate, onEnter, onEscape, dataAttribute = "data-record-id" } = params;

      if (itemIds.length === 0) {
        return;
      }

      const resolveCurrentIndex = (): number => {
        const target = event.target;
        if (target instanceof HTMLElement && target.hasAttribute(dataAttribute)) {
          const focusedId = target.getAttribute(dataAttribute);
          const focusedIndex = itemIds.findIndex((id) => id === focusedId);
          if (focusedIndex !== -1) {
            return focusedIndex;
          }
        }

        if (fallbackId != null) {
          const fallbackIndex = itemIds.findIndex((id) => id === fallbackId);
          if (fallbackIndex !== -1) {
            return fallbackIndex;
          }
        }

        return 0;
      };

      if (previousKeys.includes(event.key)) {
        event.preventDefault();
        const currentIndex = resolveCurrentIndex();
        const previousIndex = (currentIndex - 1 + itemIds.length) % itemIds.length;
        onNavigate(itemIds[previousIndex]!);
        return;
      }

      if (nextKeys.includes(event.key)) {
        event.preventDefault();
        const currentIndex = resolveCurrentIndex();
        const nextIndex = (currentIndex + 1) % itemIds.length;
        onNavigate(itemIds[nextIndex]!);
        return;
      }

      if (enableHomeEnd && event.key === "Home") {
        event.preventDefault();
        onNavigate(itemIds[0]!);
        return;
      }

      if (enableHomeEnd && event.key === "End") {
        event.preventDefault();
        onNavigate(itemIds[itemIds.length - 1]!);
        return;
      }

      if (event.key === "Enter" && onEnter) {
        onEnter(event);
        return;
      }

      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape(event);
      }
    },
    [previousKeys, nextKeys, enableHomeEnd]
  );

  return handleKeyDown;
}
