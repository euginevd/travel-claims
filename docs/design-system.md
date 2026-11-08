# Design system

UnderCover's own brand, "Sky and sunset" (decision 11): bright, reassuring and made for travel. The customers' portal gets the full warm look; the staff dashboard a calmer, denser variant of the same brand. Tokens live in each app's `src/brand.css`.

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

1. Type: Plus Jakarta Sans for everything (700 headings, 600 labels and numbers, 400 body), self-hosted; Geist Mono only for codes and the dashboard's trace.
2. Shape: cards 18px radius on white with a soft navy-tinted shadow; inputs 12px; buttons and chips are pills. Spacing on an 8px scale.

## Rules

3. Bright but calm: one sky action per screen, coral used sparingly for what's happening now, no gradients.
4. Code uses the tokens as CSS variables, never raw values; anything new is built from them and added here.
5. Icons: Lucide outline, stroke 2, `currentColor`; decorative icons are `aria-hidden`, and icon-only buttons have a label.
6. Fonts and illustrations ship with the app; no request leaves for a font CDN or an image host, so the strict CSP stays `'self'`.
7. WCAG 2.2 AA: text 4.5:1 (coral is never text on white; use `coral-ink`), controls and focus 3:1, targets at least 24×24px, sticky parts never hide the focused element.
8. Status is a word plus an icon, never colour alone. Motion is 0.2s at most, and none under `prefers-reduced-motion`.
9. Words: Australian English, sentence case, warm and plain; buttons say what happens; errors say what to do next.
10. AI output is labelled with one marker in both apps: what it decided, its reasons and sources, and how to ask a person to review it.

## Components

11. **Header:** navy band with the logo (sky disc, white umbrella, coral suitcase), pill navigation and a 3px coral edge. The portal adds a sky band under it with a dashed plane path.
12. **Tracker:** dots 28px (22px in cards). Done is navy with a white check; current is a coral ring with a soft coral halo; upcoming is a grey outline. The connector runs centre to centre, navy where done and grey ahead; labels sit centred under their dots.
13. **Status chip:** a tinted pill with a toned icon and ink text.
14. **Claim card (portal):** type icon in a sky tile, title, meta line, the amount large on the right, a status line with a toned dot, then the mini tracker; the whole card opens the claim.
15. **Claim type tile:** white card with a sky icon tile; chosen tiles get a sky border and ring.
16. **Figures (dashboard):** white cards with a toned top edge and icon, large navy numbers.
17. Every screen has loading skeletons, an empty state that says what to do, and an error state with a retry.
18. Money shows 2 decimal places in US dollars in tabular figures; dates as `8 Nov 2026`.

## Portal and dashboard

19. **Portal:** the full warm look. Sky main actions, a greeting ("Hi Oliver"), travel illustrations, roomy single-column flows that work at 360px.
20. **Dashboard:** the same tokens, calmer and denser. Navy main actions, tighter tables, sky row hover, the trace in monospace.
