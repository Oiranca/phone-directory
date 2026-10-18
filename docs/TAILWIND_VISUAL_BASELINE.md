# Tailwind 3 visual baseline

Run `pnpm run test:e2e` from the repository root. On macOS, submit it through
`launchctl` as required by `AGENTS.md`. The command uses an isolated Electron
profile and writes 16 PNGs plus `metrics.json` to
`test-results/agent-browser/tailwind-baseline/`.

The checked-in Tailwind 3 reference is in `docs/visual-baseline/tailwind3/`.
The verified Tailwind 4 capture is in `docs/visual-baseline/tailwind4/`.
Compare each route at 320 × 844, 768 × 1024, 1100 × 750, and 1440 × 900 CSS
pixels. Review navigation placement and width, text size and weight, card
borders and radius, input focus rings, and spacing. The focused inputs are
Directory search, New record name, Beepers search, and Settings editor name.
Directory result cards and the New record identity card provide bordered-card
references. The Beepers and Settings captures include bordered inputs.

Compare the matching entries in `metrics.json` before judging a visual change.
`documentWidth` must not exceed viewport width by more than one pixel;
`focus.visible` must be true. Navigation width, heading font, border, and focus
shadow are computed by the browser, so a difference has a concrete CSS value
to investigate. Screenshots remain the final check for spacing and layout.
Ignore raster differences caused only by OS font rendering when comparing
another platform with this macOS reference.

The migration in #484 regenerated the output with this same command and
reviewed all 16 pairs. Keep both captures for review; replace either only
after an intentional visual change has been reviewed.
