# Design system

UnderCover's brand, "Canopy" (decision 21): white pages, faint glows, dark text and one coral accent. The dashboard and console are a denser variant on a warmer page. Tokens live in each app's `src/brand.css` (the project page's `styles.css`); UI rules are in `code-standards.md` (25–29).

## Principles

1. Subtle: coral is an accent, never a large fill; headlines stay ink.
2. One primary button a view; everything else is secondary or a text link.
3. Reassuring before clever: customers always know where their claim is and what's next.
4. Real over generic: real claims, policy wording and words.

## Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#ffffff` | Page background: the portal and the project page |
| `--bg-work` | `#fbfaf8` | Page background: the dashboard and the console |
| `--ink` | `#24231f` | Body text and headings |
| `--ink-2` | `#64625d` | Supporting text |
| `--ink-3` | `#6f6d68` | Captions, placeholders, metadata |
| `--line` | `#ebe9e4` | Hairlines, input borders |
| `--line-2` | `#f2f0ec` | Lighter dividers between rows inside a card |
| `--line-strong`, `--line-hover` | `#e3e1dc`, `#bdb9b1` | Project page: a stronger border, and a border on hover |
| `--ink-soft` | `#3d3c39` | Dashboard: the claim summary and story text, a step softer than `--ink` |
| `--ring` | `#f0eeea` | The outer ring of double-ring cards |
| `--soft` | `#f4f3f0` | Secondary buttons, chips |
| `--acc` | `#e2795f` | Coral: the logo, the route line, the "now" step, alerts |
| `--acc-d` | `#a04e38` | Coral as text |
| `--acc-fill` | `#b35a42` | Coral only as a fill behind white text |
| `--acc-tint` | `#fbece5` | Coral tint background |
| `--acc-edge` | `#ecc0b1` | Borders of coral-tinted cards and chips |
| `--acc-glow`, `--acc-ring` | coral at 10% and 55% | The focus glow on fields; the console's primary button ring on hover |
| `--acc-hi`, `--acc-lo` | `#f0937a`, `#d96a50` | Project page: the ends of the coral gradient |
| `--good` on `--good-tint` | `#3d6b47` on `#e7f0e5` | Paid, approved, met |
| `--good-dot`, `--good-soft`, `--good-edge` | `#4f9e66`, `#7fae88`, `#d4e5d0` | Status dots, the console's run dots and legend, and the border of good states |
| `--warm` on `--warm-tint` | `#a04e38` on `#fbeae4` | Needs you, requests, delays; `--warm-edge` `#f3d8cc` is its border |
| `--info` on `--info-tint` | `#3a64b8` on `#e8eef9` | Demo tags, info chips; `--info-soft` `#8fb0dc` for the console's referred run dots |
| Washes | blush `#fbece5`, sage `#e8f0e5`, sky `#e8eef8` | Faint card-corner glows and page blobs only |

5. Type, all self-hosted: Newsreader (serif, 400, about -0.02em) for headings and stats; Plus Jakarta Sans (400, 500, 600) for body and UI; Geist Mono for code and IDs. Tabular figures in every number.
6. Contrast: 4.5:1 for text under 24px, 3:1 above; every text token passes on `--bg`, `--bg-work` and `--soft`. Edges, dots and glows are never text.
7. No hard-coded colours or inline styles: the CSP refuses them.

## Surfaces

8. **Double-ring card:** an outer ring (1px `--ring`, 8 to 10px padding, radius 30 to 34px) around an inner card (1px `--line`, radius 22 to 25px: the outer less the padding).
9. **Glass** (sign-in shells and floating chips only): translucent white, background blur, 1px white edge, soft warm shadow.
10. **Page glows:** two to four blurred blobs at 40 to 60% opacity, drifting over 25 to 35 seconds.

## Buttons and inputs

11. **Primary:** near-black glass (`#4a4844` to `#171614`), white text, radius 16px, 54px high (44px in dashboard and console), a faint coral bottom hairline; its arrow square turns coral on hover. Loading shows a spinner and the action.
12. **Secondary:** `--soft` background, ink text, radius 10px. **Tertiary:** a text link with a light underline.
13. **Inputs:** floating labels in 54px fields, radius 13px, 1px border; `:focus-visible` adds a 2px `--acc-d` ring (3:1 against white; the old glow was 1.6:1). An error is one sentence under the field in `--acc-d`.
14. **Focus:** a 2px `--acc` outline with 2px offset on every control; 3px white plus 2px coral on primary buttons.

## Motion

15. Entrances rise 14px and fade over about 0.9s, staggered; stats count up; the Wattle mark animates only while working.
16. Everything respects `prefers-reduced-motion`. Never: parallax, or motion that blocks input.

## Logo and icons

17. **Logo:** a three-scallop umbrella with a dot, white on a coral tile (radius 28%, `#ea8d73` to `#d96a50`), and lowercase **undercover** in Plus Jakarta Sans 600 with a subtitle per app. 38 to 40px in top bars, 26px at least.
18. **Icons:** Lucide, stroke 1.75, `currentColor`; decorative ones `aria-hidden`, icon-only buttons labelled. No emoji or sparkles.

## Components

19. **Top bar:** logo, quiet navigation, **Ask Wattle** with a small "AI" tag, the person's initials and a link to the project page. The portal's: **Home**, **Messages** (a coral dot for anything new), **Claims** and the initials for Settings; icons only on a phone. **New chat** is in the composer, once there's a chat.
20. **Wattle AI:** the same sprig mark in every app, a button and right-hand panel in the dashboard and console and the home screen in the portal (36), sources as chips, and "AI powered · cites its sources · a claims expert makes the final call". In the dashboard, actions wait on a confirm card.
21. **Tracker:** received, checked, assessed, decided, paid; the current step in coral.
22. **Status chip:** a tinted pill with a toned icon and ink text.
23. **Stat tile:** a double-ring card with a label, a Newsreader number and one line of context.
24. **Charts (console):** single-series lines and bars in ink tokens, with the latest value in words.
25. **Feedback (portal):** thumbs up or down; down opens an optional 300-character comment.
26. **Similar claims (dashboard):** up to five rows under Risk signals, labelled "a guide, not a decision".
27. **Settings (dashboard):** one card of fields with ranges, a reason and one Save button, enabled only on a change; read-only for handlers.
28. **Grade chip (console):** the judge's score as a letter, A (3) to F (0); "Not graded" in a plain chip.
29. **Status group (dashboard):** the agent and payouts as one pill in the top bar, each a soft green segment when on or live and soft red when off or paused, with a 7px dot (it pulses while the agent works) and a fixed-width count; never wraps. Changing either opens the same small card asking why in one line. Paused payouts show one quiet line under the header, never a panel.
30. Anything new is built from the tokens and these components, and added here once settled.

## Not this

31. Coloured or gradient headline text, coral as a large fill, and more than one primary button a view.
32. Emoji and sparkle icons, placeholder copy, stock photos and generated images.
33. Fake buttons: anything clickable is a real `<button>` or `<a href>`.

## Words

34. Australian English, sentence case, warm and plain; buttons say what happens, errors what to do next.
35. Money in US dollars to 2 decimals; dates as `8 Nov 2026`.

## This project

36. **Portal:** the roomiest, and a conversation (decision 53): "Hi Oliver.", one news line, a large centred composer, three suggestions and an at-a-glance row; a reply is a headline, short lines and tappable choices, cards in one ring; the side panel holds Messages, Claims and Settings; from 1100px Claims opens wide, the list beside the claim; lists show three, then five more a tap. Works at 390px; an animated route map at sign-in.
37. **Dashboard:** `--bg-work`, denser tables, 44px buttons; wide tables scroll inside their card. **Today** opens on Wattle's brief (a Newsreader sentence on a faint wattle wash), four figures, then the claims that need you, each row saying why. A claim opens on the **verdict** card: by-line, a Newsreader headline, the reason, the one action, and the checks beside it; the evidence sits in tabs below.
38. **Console:** the dashboard's density. A top-bar switch, **Overview | Observe | Evaluate | Secure | Govern**, the control plane's jobs, with the section's pages as tabs below (none for Overview), and the agent and payouts switches as green or red pills before Wattle (dots only below 1180px). Overview: a verdict ring with the version, then release gates as rows (pass, watch, fail, no evidence), each with its range bar. The agents map is a hand-laid SVG on a grid: boxes tinted by who uses them, the claim's path in one line, gates as pills on it, trust boundaries dashed. A tile can be its own filter; a small-sample score shows its range as a shaded band and its target as a tick. Untested defence layers are hatched in `--acc-tint`.
39. **Project page:** one screen without scrolling: headline, brief, walkthrough video and app links.
40. **Fit the window (dashboard and console):** a page fits one viewport without scrolling and fills its height, with no empty band at the bottom. The last row stretches (a flex column at least `100dvh` less the top bar and tabs) up to a cap, about 440px, so no box outgrows the rest; a chart in it is drawn at its box's size, and rows line up with the columns above. Pages use `.view.fit`: the page is the window's height and the row marked `.fill` takes the rest, its list scrolling inside. Detail sections sit behind pill tabs in that row (Live, Scoreboard). Check at 1710×1270, the developer's window, where nothing scrolls; at 1440×900 the filled row keeps a usable height and the page may scroll.
