# Design system

UnderCover's own brand, "Sky and sunset" (decision 11): bright, reassuring and made for travel. The customers' portal gets the full warm look; the staff dashboard and the AI assurance console a calmer, denser variant of the same brand. Tokens live in each app's `src/brand.css`. The UI rules every screen follows are in `code-standards.md` (25–29).

## Principles

1. Bright but calm: one sky action per screen, coral used sparingly for what's happening now, no gradients.
2. Reassuring before clever: a customer should always know where their claim is and what happens next.
3. Motion explains a change and never decorates.
4. Real over generic: real claims, real policy wording, real words; nothing that looks generated.

## Tokens

| Token | Value | Use |
|-------|-------|-----|
| `navy` (`ink`, `bg-ink`) | `#0b2545` | Header, headings, primary text, the dashboard's main action, completed steps |
| `ink-2` | `#4a5b73` | Body and secondary text |
| `ink-3` | `#8a9ab0` | Input borders; never essential text |
| `sky` (`primary`, `accent`) | `#1e6fd9` | The portal's main action, links, focus rings |
| `sky-tint` | `#e8f3fb` | Sky bands, icon tiles, row hover |
| `coral` | `#ff6b4a` | "Now": the current step, the header edge, the sun; graphics only |
| `coral-ink` | `#c23f22` | Coral when it has to be text (the greeting) |
| `bg` / `bg-2` / `bg-3` | `#f4f7fb` / `#ffffff` / `#eef3f9` | Page, cards, sunken zones and table headers |
| `line` | `#dce5f0` | Card and input borders, upcoming steps |
| `good` / `info` / `refer` / `warn` / `bad` | `#1b7f4c` / sky / `#6941c6` / `#b45309` / `#b42318` | Status tones, each with a `-tint` background |

5. Type: Plus Jakarta Sans for everything (700 headings, 600 labels and numbers, 400 body), self-hosted; Geist Mono only for codes and the trace. Tabular figures in every number.
6. Shape: cards 18px radius on white with a soft navy-tinted shadow; inputs 12px; buttons and chips are pills. Spacing on an 8px scale.
7. Contrast: coral is never text on white; use `coral-ink`.

## Motion

8. 0.2s at most, easing out, `transform` and `opacity` only; the current tracker step's coral halo is the one motion that repeats.
9. Never: scroll-triggered reveals, parallax, or motion that blocks input.

## Imagery

10. Travel illustrations in the brand's colours (a globe, a plane on a dashed path, a suitcase, an umbrella) on sign-in, empty states and the portal's welcome; work screens carry data, not pictures.
11. Icons: Lucide outline, stroke 2, `currentColor`; decorative icons are `aria-hidden`, and icon-only buttons have a label.

## Components

12. **Header:** navy band with the logo (sky disc, white umbrella, coral suitcase), pill navigation and a 3px coral edge. The portal adds a sky band under it with a dashed plane path.
13. **Tracker:** dots 28px (22px in cards). Done is navy with a white check; current is a coral ring with a soft coral halo; upcoming is a grey outline. The connector runs centre to centre, navy where done and grey ahead; labels sit centred under their dots.
14. **Status chip:** a tinted pill with a toned icon and ink text.
15. **Claim card (portal):** type icon in a sky tile, title, meta line, the amount large on the right, a status line with a toned dot, then the mini tracker; the whole card opens the claim.
16. **Claim type tile:** white card with a sky icon tile; chosen tiles get a sky border and ring.
17. **Figures (dashboard):** white cards with a toned top edge and icon, large navy numbers.
18. **Wattle AI:** the same mark, header button and right-hand panel in all three apps, with sources as chips.
19. Anything new is built from the tokens and these components, and added here once settled.

## Not this

20. Gradients, gradient text, glassmorphism and glows.
21. Coral as body text or for anything but "now".
22. Emoji and sparkle icons in the product's UI.
23. Placeholder copy, stock photos and generated images.

## Words

24. Australian English, sentence case, warm and plain; buttons say what happens; errors say what to do next.
25. Money shows 2 decimal places in US dollars in tabular figures; dates as `8 Nov 2026`.

## This project

26. **Portal:** the full warm look. Sky main actions, a greeting ("Hi Oliver"), travel illustrations, roomy single-column flows that work at 360px.
27. **Dashboard:** the same tokens, calmer and denser. Navy main actions, tighter tables, sky row hover, the trace in monospace.
28. **Console:** the dashboard's density, for AI engineers: runs, rounds, the red team and threat coverage.
29. **Grade chip (console):** the judge's score as a letter with an award icon, A (3) good, B (2) info, C (1) warn, F (0) bad, followed by "Same grounds" and "Same section" as Yes or No; "Not graded" in a plain chip.
30. **Dispatch card (dashboard):** a panel above the queue: for a senior handler the agents-at-once field and **Work the waiting claims**, confirmed inline with the count and a cost range; while it runs, a progress bar, "n of m worked", count chips (decided, waiting for sign-off, referred, not started) and the claims in a collapsed table.
