# Keyboard Shortcuts

The app supports a small global shortcut set for fixed-workstation use.

| Shortcut | Action |
| --- | --- |
| `/` | Focus directory search when the current view has a search field |
| `Ctrl+N` / `Cmd+N` | Open the new record form |
| `Ctrl+S` / `Cmd+S` | Save the active record form |
| `Escape` | Cancel the active record form when focus is not inside a text field |
| `Alt+1` | Go to Directory |
| `Alt+2` | Go to New record |
| `Alt+3` | Go to Settings |
| `Alt+4` | Go to Buscas |
| `Alt+5` | Go to Duplicados |

Shortcuts that use plain printable keys are ignored while focus is inside text inputs, textareas, selects, or editable content so native typing and editing behavior is preserved.

## Implementation convention: `data-keyboard-*` / `data-page-search` markers

MANT-17: this convention previously only lived in code comments in
`src/renderer/components/layout/AppShell.tsx`; documented here so the
contract between AppShell's single global `keydown` listener and each
page/form is discoverable outside the source.

`AppShell` owns one `window`-level `keydown` listener (there is no per-page
shortcut wiring). To trigger a page- or form-specific action, a page marks
the relevant DOM element with one of these data attributes; AppShell then
`document.querySelector`s for it at keypress time instead of the page
registering its own handler:

| Attribute | Placed on | Read by AppShell to implement |
| --- | --- | --- |
| `data-keyboard-cancel` | The form's "Cancelar" button | `Escape` (clicks it) and `Ctrl/Cmd+N` (if present, suppresses the "new record" navigation instead of discarding unsaved form state — see the OIR comment at the Ctrl/Cmd+N handler) |
| `data-keyboard-submit` | The `<form>` element itself | `Ctrl/Cmd+S` (calls `form.requestSubmit()`) |
| `data-page-search` | The page's free-text search `<input>` | `/` (focuses it; falls back to a couple of known page-specific element ids if no page currently sets this attribute) |

Because AppShell just queries the DOM for these markers, adding the
shortcut contract to a new page/form is a matter of adding the matching
`data-*` attribute — no changes to AppShell itself are needed. Conversely,
removing/renaming one of these attributes on a page silently breaks that
page's Escape/Ctrl+S/`/` shortcut, since AppShell has no other way to find
the element.
