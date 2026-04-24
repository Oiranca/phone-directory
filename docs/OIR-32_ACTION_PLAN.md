# OIR-32 Action Plan

Issue: `OIR-32`

## Objective

Improve app-wide accessibility and make the directory easier to browse under real hospital workflows, with capped pagination and clearer navigation semantics.

## Current Working Assumptions

- The directory should never expose an effectively infinite result list.
- The result list should show at most 5 records per page.
- Search and filters must remain fast and predictable.
- Keyboard and screen-reader users must receive the same structural context as pointer users.

## Audit Summary

### App-wide accessibility

1. Add a skip link and reinforce landmark navigation in the app shell.
2. Standardize loading and failure states with `role="status"` or `role="alert"` where appropriate.
3. Reduce color-only meaning in result cards and warning states.
4. Keep focus visibility consistent across buttons, list controls, and pagination.
5. Keep error and warning feedback persistent enough for assistive-tech and slow-reading workflows.

### Directory UX

1. Replace the long scrolling result stack with explicit pagination.
2. Cap the list to 5 items per page.
3. Keep selection predictable when search, filters, or page changes.
4. Make result count and current page visible at a glance.
5. Improve privacy signalling with visible text, not only a colored dot.
6. Reduce repeated metadata and visual noise in the detail panel so record interpretation is faster.

## Progress Snapshot

Status as of 2026-04-24:

- Phase 1: complete
- Phase 2: complete
- Phase 3: complete
- Phase 4: complete for the directory page and key app-shell flows
- Phase 5: verification complete for test, typecheck, and build

Implemented so far:

- Linear issue `OIR-32` created and moved to `In Progress`
- branch created: `feat/oir-32-directory-a11y-pagination`
- app-shell skip link and route-focus target added
- page-local loading and failure states upgraded with announcement semantics
- warning/error toasts made persistent by default with stronger dismiss target sizing
- directory pagination capped at 5 records with compact windowed controls
- directory selection behavior made predictable across search, filters, and paging
- directory result cards improved with clearer metadata and visible privacy text
- directory header noise reduced
- detail panel hierarchy cleaned up and repeated metadata reduced
- project design context captured in `.impeccable.md`

## Implementation Plan

### Phase 1. Baseline audit and issue framing

- Create and move the Linear issue to `In Progress`.
- Capture accessibility and UX findings for the directory and key app surfaces.
- Convert findings into a scoped action plan before code changes.

Status: done

### Phase 2. App shell accessibility upgrades

- Add a skip link to jump directly to the main content region.
- Preserve clear landmark structure for header, nav, and main.
- Verify focus visibility from first Tab press.

Status: done

### Phase 3. Directory browsing redesign

- Introduce client-side pagination with 5 results per page.
- Expose pagination controls with accessible labels and current-page state.
- Add visible result context without cluttering the header.
- Reset or realign selection predictably when result scope changes.

Status: done

### Phase 4. Directory accessibility hardening

- Expose the result collection as a selectable results region.
- Use explicit selected-state semantics on result options.
- Replace color-only privacy cues with visible privacy text.
- Preserve keyboard reachability for search, filters, results, and pagination.
- Remove repeated metadata and tighten the detail panel hierarchy.

Status: done for the current scope

### Phase 5. Validation

- Update directory tests for pagination and selected-state semantics.
- Run targeted tests, typecheck, and build.
- Record residual risks and follow-up items after the first pass.

Status: done

## Expected Deliverables

- Updated branch: `feat/oir-32-directory-a11y-pagination`
- Linear issue in progress: `OIR-32`
- Directory pagination capped at 5 records
- App-shell accessibility improvements
- Test coverage for new directory behavior

## Follow-up Candidates

- Replace blocking browser confirm flows with accessible in-app confirmation dialogs.
- Review Settings and Import/Export states for reusable status/error panels.
- Add a dedicated accessibility review pass for form-field error announcements across the whole app.
- Evaluate arrow-key navigation inside the results list if we decide to promote the current listbox pattern further.
- Revisit the detail panel at very long record names and at 200%-400% zoom for final polish.
