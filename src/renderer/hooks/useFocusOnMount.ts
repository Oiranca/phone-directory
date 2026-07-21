import { useLayoutEffect } from "react";
import type { RefObject } from "react";

/**
 * Shared primitive for the "focus this element when a
 * panel/form opens" pattern that was hand-rewritten independently in
 * DataManagementSection.tsx (focus the import-preview panel heading when it
 * opens) and BeepersPage.tsx (focus the first form field when the
 * create/edit form opens).
 *
 * `when` is intentionally typed as `unknown` rather than `boolean`: it is
 * used directly as the effect's dependency, so callers that need to
 * re-trigger focus on more than one condition (e.g. BeepersPage re-focusing
 * when switching from "create" to "edit" while the form stays open) can pass
 * a composite value (e.g. `showForm && (editingId ?? "new")`) instead of a
 * plain boolean. Any truthy value triggers a focus call; a falsy value is a
 * no-op. Changing the truthy value (not just its truthiness) re-triggers the
 * focus call, matching `useLayoutEffect`'s dependency semantics.
 */
export function useFocusOnMount<T extends HTMLElement>(ref: RefObject<T | null>, when: unknown): void {
  useLayoutEffect(() => {
    if (when) {
      ref.current?.focus();
    }
  }, [when]);
}
