# Responsive and Accessibility Improvement Plan

## Scope

This plan covers all current renderer surfaces:

- `src/renderer/components/layout/AppShell.tsx`
- `src/renderer/components/inputs/SelectField.tsx`
- `src/renderer/pages/DirectoryPage.tsx`
- `src/renderer/pages/ContactFormPage.tsx`
- `src/renderer/pages/ImportExportPage.tsx`
- `src/renderer/pages/SettingsPage.tsx`
- `src/renderer/pages/NotFoundPage.tsx`
- `src/renderer/app/App.tsx`

The goal is to make every view, button, select, and form control consistently responsive, keyboard-safe, screen-reader-friendly, and testable.

## Audit Snapshot

| Dimension | Score | Notes |
| --- | --- | --- |
| Accessibility | 2/4 | Good semantic baseline, but error handling, live regions, and form-state announcements are incomplete. |
| Responsive Design | 3/4 | Most layouts stack correctly, but several controls and action groups still depend on compact desktop assumptions. |
| Performance | 4/4 | No meaningful render or animation issues found in the current renderer code. |
| Theming | 3/4 | Styling is consistent, but focus behavior and state styling are not centralized yet. |
| Anti-Patterns | 4/4 | The UI does not read as generic AI slop. |
| Total | 16/20 | Good base. Needs a targeted accessibility and component-hardening pass. |

## Highest-Priority Findings

### P1. Form validation is not announced accessibly

- Location:
  - `src/renderer/pages/ContactFormPage.tsx:449`
  - `src/renderer/pages/ContactFormPage.tsx:756`
  - `src/renderer/pages/ContactFormPage.tsx:881`
  - `src/renderer/pages/ContactFormPage.tsx:943`
- Problem:
  - Validation errors are rendered as plain text only.
  - Inputs do not expose `aria-invalid` or `aria-describedby`.
  - The form-level failure message is not a live region.
- Impact:
  - Screen-reader users may not know which field failed or when submission was blocked.
- Required fix:
  - Introduce a shared field-error pattern with stable IDs.
  - Wire invalid fields to `aria-invalid="true"` and `aria-describedby`.
  - Promote form-level submit errors to `role="alert"` or `aria-live="assertive"`.

### P1. Status and error feedback is not consistently announced

- Location:
  - `src/renderer/pages/ImportExportPage.tsx:360`
  - `src/renderer/pages/SettingsPage.tsx:186`
  - `src/renderer/app/App.tsx:159`
  - `src/renderer/app/App.tsx:180`
- Problem:
  - Success, error, loading, and retry states render visually but are not exposed through live regions.
- Impact:
  - Async operations can complete without screen-reader users receiving timely feedback.
- Required fix:
  - Add a shared feedback component with severity variants and correct `role`/`aria-live` behavior.

### P1. The form page still contains multiple undersized touch targets

- Location:
  - `src/renderer/pages/ContactFormPage.tsx:729`
  - `src/renderer/pages/ContactFormPage.tsx:792`
  - `src/renderer/pages/ContactFormPage.tsx:854`
  - `src/renderer/pages/ContactFormPage.tsx:887`
- Problem:
  - Inline `Eliminar` actions and compact checkbox rows do not reliably provide a 44x44 touch target.
- Impact:
  - Mobile and tablet users will have higher miss-tap rates, especially in repeated phone/email sections.
- Required fix:
  - Convert micro-actions into padded button variants.
  - Replace raw inline checkbox rows with larger checkbox-card or switch-row controls.

### P2. Navigation and record selection state are not fully exposed

- Location:
  - `src/renderer/components/layout/AppShell.tsx:34`
  - `src/renderer/pages/DirectoryPage.tsx:211`
- Problem:
  - The main `nav` has no explicit accessible label.
  - Selected record cards rely on visual styling only.
- Impact:
  - Assistive technologies do not get the clearest possible navigation and selection context.
- Required fix:
  - Add `aria-label` to main navigation.
  - Expose selected result state with `aria-pressed`, `aria-current`, or a listbox-style selection pattern.

### P2. The custom select needs stronger WCAG hardening

- Location:
  - `src/renderer/components/inputs/SelectField.tsx:19`
  - `src/renderer/components/inputs/SelectField.tsx:218`
- Problem:
  - The custom combobox works for basic keyboard interaction, but the pattern is fragile and has limited announcement/state coverage.
  - It has no dedicated error/help text support and no shared responsive constraints.
- Impact:
  - This component is used in multiple views, so any weakness is multiplied across the app.
- Required fix:
  - Expand the API for helper text, error text, invalid state, and disabled state.
  - Verify the pattern against WCAG 2.2 and ARIA Authoring Practices with tests.

## Secondary Findings

### P2. Typography needs an accessibility-first review, including font choice

- Location:
  - `src/renderer/styles/globals.css:5`
  - all renderer views inheriting the global type system
- Problem:
  - The app currently relies on a single global font stack without a documented accessibility rationale.
  - The plan did not yet define minimum text sizing, line-height, zoom behavior, or font replacement criteria.
- Impact:
  - A readable layout can still fail users with low vision, dyslexia, cognitive load sensitivity, or browser zoom needs if type choices and scales are not intentionally controlled.
- Required fix:
  - Audit the current font stack for legibility at small sizes, dense forms, and long labels.
  - Replace or adjust fonts if they reduce character distinction, perform poorly at small UI sizes, or create cramped text metrics.
  - Define minimum text size, line-height, paragraph width, and zoom/reflow constraints at the system level.

### P2. Browser confirm dialogs should be replaced with in-app confirmation flows

- Location:
  - `src/renderer/pages/ImportExportPage.tsx:133`
  - `src/renderer/pages/ImportExportPage.tsx:218`
  - `src/renderer/app/App.tsx:47`
- Problem:
  - Native blocking confirms are functional, but they are hard to style, hard to test deeply, and inconsistent across platforms.
- Impact:
  - This weakens responsive consistency and accessible focus management in destructive flows.
- Required fix:
  - Introduce a controlled confirmation dialog component with focus trap, initial focus, Escape handling, and mobile-safe layout.

### P2. Empty, loading, and failure states are visually fine but structurally thin

- Location:
  - `src/renderer/pages/DirectoryPage.tsx:112`
  - `src/renderer/pages/ImportExportPage.tsx:251`
  - `src/renderer/pages/SettingsPage.tsx:47`
  - `src/renderer/pages/NotFoundPage.tsx:1`
- Problem:
  - These states are plain blocks without reusable semantics, navigation recovery actions, or status-region consistency.
- Impact:
  - The app works, but system state handling is harder to scale and harder to test uniformly.
- Required fix:
  - Create a reusable state panel pattern for loading, empty, error, and recovery surfaces.

### P3. Focus and state styling are repeated instead of systematized

- Location:
  - `src/renderer/styles/globals.css:1`
  - repeated across page inputs and buttons
- Problem:
  - Focus rings and control states are applied ad hoc at the component level.
- Impact:
  - Future UI work can drift into inconsistent interactive behavior.
- Required fix:
  - Define shared interactive tokens and utility classes for focus, disabled, destructive, and selected states.

## Work Plan

### Phase 1. Establish shared UI foundations

Goal: remove repeated accessibility and responsive debt from the component layer.

Tasks:

1. Create shared control primitives for:
   - field hint text
   - field error text
   - status banners
   - empty/loading/error state panels
2. Add shared style tokens or utility classes for:
   - minimum touch target
   - focus-visible ring
   - selected state
   - destructive action state
   - accessible typography scale
3. Extend `SelectField` to support:
   - helper text
   - error text
   - invalid state
   - disabled state
   - stronger test coverage for keyboard and screen-reader semantics
4. Define system typography rules for:
   - body text minimum size
   - label and helper text minimum size
   - line-height by text role
   - comfortable text measure for long content
   - font fallback behavior if the preferred family is unavailable

Definition of done:

- No page-level control needs to hand-roll error and status semantics.
- All interactive controls meet the 44x44 minimum target rule.
- Typography rules are documented before page refactors begin.

### Phase 2. Fix form accessibility and mobile ergonomics

Goal: make `ContactFormPage` reliable on small screens and assistive tech.

Tasks:

1. Apply the shared field-state API to every input, textarea, checkbox, and select.
2. Refactor repeated phone/email editors into reusable subcomponents.
3. Replace compact inline checkbox rows with stacked or card-based toggles on narrow screens.
4. Enlarge `Eliminar`, `Añadir`, `Guardar`, and `Cancelar` actions for touch use.
5. Add tests covering:
   - invalid submission announcements
   - field-level error association
   - keyboard navigation through repeated sections
   - 200% zoom and reflow-safe form layout

Definition of done:

- Every invalid field is announced and linked to its error message.
- The repeated phone/email sections are usable without precision tapping.

### Phase 3. Harden directory browsing and selection behavior

Goal: improve browsing, filter control semantics, and detail-state clarity.

Tasks:

1. Label main navigation explicitly.
2. Expose selected result state accessibly in the results list.
3. Review sticky side panels and two-column breakpoints for narrow laptop widths.
4. Add tests for:
   - keyboard selection flow in the results list
   - filter announcements
   - no-overflow behavior at small widths
   - readable truncation and wrapping behavior at increased text size

Definition of done:

- A keyboard-only user can search, filter, select, and open edit mode without ambiguity.

### Phase 4. Replace destructive browser dialogs with app dialogs

Goal: unify confirmation flows across Electron and improve accessibility.

Tasks:

1. Implement a reusable confirmation dialog component.
2. Migrate destructive import and reset flows away from `window.confirm`.
3. Add focus-management tests and escape-close tests.

Definition of done:

- All destructive flows use the same dialog pattern with predictable focus behavior.

### Phase 5. Final responsive and accessibility sweep

Goal: close remaining cross-page gaps and leave regression coverage behind.

Tasks:

1. Review all views at narrow mobile, tablet, small laptop, and large desktop widths.
2. Review all views at:
   - 200% browser zoom
   - 320px effective width
   - keyboard-only navigation
   - visible focus-only navigation
   - screen-reader-announced status changes
3. Add targeted tests for status regions, retry flows, empty states, and text reflow.
4. Run the final validation suite:
   - `npm test`
   - `npm run typecheck`
   - `npm run build`

Definition of done:

- No critical or major responsive/a11y gaps remain in the current renderer routes.

## Recommended Execution Order

1. typography and global interactive foundations
2. `SelectField`
3. shared status and field-state primitives
4. `ContactFormPage`
5. `DirectoryPage`
6. `ImportExportPage`
7. `SettingsPage`
8. `AppShell`, `App`, and `NotFoundPage`
9. final regression sweep

## Typography Accessibility Requirements

### Font decision rules

Replace the current font stack if any of the following are true during implementation review:

- ambiguous glyph shapes reduce distinction between `I`, `l`, `1`, `O`, and `0`
- the font looks cramped below common UI sizes
- accented Spanish content renders unevenly or too tightly
- bold and semibold weights reduce readability in dense forms
- fallback rendering changes layout too aggressively across macOS and Windows

Preferred direction:

- keep a highly legible sans-serif body font optimized for UI reading
- avoid decorative display fonts in workflow-critical screens
- preserve strong support for Spanish diacritics and symbols
- use stable fallbacks with close metrics to reduce layout shift

### Minimum typography rules

- body text: minimum `16px`
- form labels: minimum `14px`, only if contrast stays AA-compliant and spacing remains comfortable
- helper and status text: minimum `14px`
- line-height:
  - body copy: at least `1.5`
  - labels and compact UI text: at least `1.4`
  - headings: at least `1.2`
- avoid long text measures beyond roughly `65-75ch`
- never rely on ultra-light font weights for functional UI

### Typography accessibility checks

- verify text remains readable at 200% zoom without horizontal scrolling on key views
- verify long labels and helper text wrap without overlapping adjacent controls
- verify placeholder text is not the only source of field guidance
- verify link, button, badge, and status text still meet contrast requirements at their actual rendered sizes
- verify uppercase labels keep enough letter spacing and do not become harder to parse at small sizes

## Accessibility Coverage Checklist

The implementation pass should explicitly verify all of the following:

- landmarks: `header`, `nav`, `main`, `aside`, and page headings are consistent
- heading order is logical per route
- all form controls have programmatic labels
- all validation messages are associated to fields
- all async updates are announced with appropriate live-region politeness
- all dialogs manage initial focus, trapped focus, and focus return
- all buttons and links expose a visible focus state
- all interactive elements meet the 44x44 minimum touch target
- all destructive actions expose stronger visual and semantic cues
- all screens work with keyboard-only navigation
- no route requires color alone to convey state
- no key flow breaks at 200% zoom or narrow viewport reflow
- text contrast and non-text contrast meet WCAG AA
- custom controls match ARIA Authoring Practices closely enough to test and maintain confidently

## Test Expansion Plan

Add or extend coverage in:

- `src/renderer/components/inputs/SelectField.test.tsx`
- `src/renderer/pages/ContactFormPage.test.tsx`
- `src/renderer/pages/DirectoryPage.test.tsx`
- `src/renderer/pages/ImportExportPage.test.tsx`
- `src/renderer/pages/SettingsPage.test.tsx`
- `src/renderer/app/App.test.tsx`

Recommended new checks:

- screen-reader-visible validation errors
- `aria-live` feedback for async operations
- keyboard-only list and select interaction
- responsive button stacking at narrow widths
- destructive flow dialog focus handling
- 200% zoom and text reflow-safe layout assertions
- font fallback and wrapping checks for long labels or helper text

## Validation Baseline

Current baseline observed during this review:

- `npm test`: PASS, 111 tests passed
- `npm run typecheck`: PASS
- `npm run build`: PASS

Notes:

- The existing test suite emits one expected stderr line from the intentional bootstrap-failure test in `App.test.tsx`.
- No build or typecheck failures were observed in this audit pass.
