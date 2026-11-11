# Design system

UnderCover's brand, "Canopy" (decision 21): subtle and premium. White pages, faint glows, dark text and one coral accent; nothing that looks generated. The customers' portal and the project page are the roomiest; the handlers' dashboard and the AI assurance console are a denser variant on a warmer page. Tokens live in each app's `src/brand.css` (the project page's `styles.css`). The UI rules every screen follows are in `code-standards.md` (25–29).

## Principles

1. Subtle: coral is an accent, never a fill for a large area; headlines stay ink, italic words included.
2. One primary button a view; everything else is secondary or a text link.
3. Reassuring before clever: a customer should always know where their claim is and what happens next.
4. Real over generic: real claims, real policy wording, real words.

## Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#ffffff` | Page background: the portal and the project page |
| `--bg-work` | `#fbfaf8` | Page background: the dashboard and the console |
| `--ink` | `#24231f` | Body text and headings |
| `--ink-2` | `#64625d` | Supporting text |
| `--ink-3` | `#6f6d68` | Captions, placeholders, metadata |
| `--line` | `#ebe9e4` | Hairlines, input borders |
| `--ring` | `#f0eeea` | The outer ring of double-ring cards |
| `--soft` | `#f4f3f0` | Secondary buttons, chips |
| `--acc` | `#e2795f` | Coral: the logo, the route line, the "now" step, alerts |
| `--acc-d` | `#a04e38` | Coral as text; `#b35a42` only as a fill behind white text |
| `--acc-tint` | `#fbece5` | Coral tint background |
| `--good` | `#3d6b47` on `#e7f0e5` | Paid, approved, met |
| `--warm` | `#a04e38` on `#fbeae4` | Needs you, requests, delays |
| `--info` | `#3a64b8` on `#e8eef9` | Demo tags, info chips |
| Washes | blush `#fbece5`, sage `#e8f0e5`, sky `#e8eef8` | Faint card-corner glows and page blobs only |

5. Type: Newsreader (serif, 400, about -0.02em) for headings and stat numbers; Plus Jakarta Sans (400, 500, 600) for body and UI; both self-hosted. Tabular figures in every number.
6. Contrast: 4.5:1 for text under 24px, 3:1 above; every token above passes on `--bg`, `--bg-work` and `--soft`.
7. No hard-coded colours in components, and no inline styles: the apps' Content-Security-Policy refuses them.

## Surfaces

8. **Double-ring card:** an outer ring (1px `--ring`, 8 to 10px padding, radius 30 to 34px) around an inner card (1px `--line`, radius 22 to 25px); the inner radius is the outer one less the padding.
9. **Glass** (sign-in shells and floating chips only): translucent white with a background blur, a 1px white edge and a very soft warm shadow.
10. **Page glows:** two to four blurred blobs at 40 to 60% opacity, mostly behind the main card, drifting over 25 to 35 seconds.

## Buttons and inputs

11. **Primary:** near-black glass (`#4a4844` to `#171614`), white text, radius 16px, 54px high (44px in the dashboard and console), a faint coral hairline along the bottom; its arrow sits in a small glass square that turns coral on hover. Loading shows a spinner and the action in progress.
12. **Secondary:** `--soft` background, ink text, radius 10px. **Tertiary:** a text link with a light underline.
13. **Inputs:** floating labels in 54px fields, radius 13px, white with a 1px border; focus adds a coral glow and the label turns `--acc-d`; an error is one short sentence under the field in `--acc-d`.
14. **Focus:** every link, button and field shows a ring: a 2px `--acc` outline with 2px offset, and 3px white plus 2px coral on primary buttons.

## Motion

15. Entrances rise 14px with a fade over about 0.9s, staggered; stats count up; the Wattle mark animates only while Wattle is working.
16. Everything respects `prefers-reduced-motion`. Never: parallax, or motion that blocks input.

## Logo and icons

17. **Logo:** an umbrella canopy with three scallops and a dot for the traveller, white on a coral tile (radius 28%, `#ea8d73` to `#d96a50`); the wordmark is lowercase **undercover** in Plus Jakarta Sans 600, all ink, with a subtitle per app: "Travel insurance", "Claims workspace", "AI assurance". 38 to 40px in top bars, 26px at least.
18. **Icons:** Lucide, stroke 1.75, `currentColor`, in soft tiles; decorative icons are `aria-hidden` and icon-only buttons have a label. No emoji, sparkles or text glyphs standing in for icons.

## Components

19. **Top bar:** the logo, quiet navigation, **Ask Wattle** (white, ink text, a small "AI" tag), the person's initials and, in each app, a link back to the project page.
20. **Wattle AI:** the same sprig mark, header button and right-hand panel in all three apps, with sources as chips and the line "AI powered · cites its sources · a claims expert makes the final call". In the dashboard a step shows as a card, a sign-off, send-back or dispatch waits on a confirm card, and a quiet line under the answer gives the turn's steps, time and cost.
21. **Tracker:** received, checked, assessed, decided, paid; the current step in coral.
22. **Status chip:** a tinted pill with a toned icon and ink text; Met, Not met and No data on the success criteria.
23. **Stat tile:** a double-ring card with a label, a Newsreader number and one line of context (the Scoreboard, Live).
24. **Charts (console):** single-series lines and bars in ink tokens, with the latest value in words.
25. **Feedback (portal):** two small thumb buttons under an answer or a decision's reason; a thumbs down opens an optional 300-character comment, then "Thanks".
26. **Similar claims (dashboard):** a panel under Risk signals: a one-line summary, then up to five rows (claim link, outcome chip, amounts, section and reason), labelled "a guide, not a decision".
27. **Settings (dashboard):** one card of fields with helper text and ranges, a reason field and the one Save button, disabled until something changed; read-only with a note for handlers who can't change them; then Recent changes.
28. **Grade chip (console):** the judge's score as a letter, A (3) to F (0), with "Same grounds" and "Same section"; "Not graded" in a plain chip.
29. **Dispatch card (dashboard):** above the queue: for a senior handler the agents-at-once field and **Work the waiting claims**, confirmed with the count and a cost range; while it runs, a progress bar, count chips and the claims in a collapsed table.
30. Anything new is built from the tokens and these components, and added here once settled.

## Not this

31. Coloured or gradient headline text, coral as a large fill, and more than one primary button a view.
32. Emoji and sparkle icons, placeholder copy, stock photos and generated images.
33. Fake buttons: anything clickable is a real `<button>` or `<a href>`.

## Words

34. Australian English, sentence case, warm and plain; buttons say what happens; errors say what to do next.
35. Money shows 2 decimal places in US dollars in tabular figures; dates as `8 Nov 2026`.

## This project

36. **Portal:** the roomiest. A greeting ("Hi Oliver"), single-column flows that work at 390px, a sign-in page with the animated route map.
37. **Dashboard:** `--bg-work`, denser tables, 44px buttons; wide tables scroll inside their card.
38. **Console:** the dashboard's density, for AI engineers: the Scoreboard, Live, Improvement, Claim trace, the red team and threat coverage.
39. **Project page:** one screen that fits a large monitor without scrolling: the headline, a brief, the walkthrough video and the three apps' links.
