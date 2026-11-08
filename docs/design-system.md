# Design system

Built on the [ArcVault design system](https://claude.ai/artifact/SWnGNCZKAxQBhxJ68cv5ao): the part an app uses, then the project's own choices.

## Tokens

| Token | Value | Use |
|-------|-------|-----|
| `bg` | `#fbf7f0` | Page |
| `bg-2` | `#fffdfa` | Cards and panels |
| `bg-3` | `#f3ece0` | Sunken zones, table headers, excluded amounts |
| `bg-ink` / `on-ink` | `#17120c` / `#f6efe3` | Header band, primary buttons |
| `ink` | `#1b1610` | Headings, primary text, large numbers |
| `ink-2` | `#6e6457` | Body and secondary text |
| `ink-3` | `#9a8e7e` | Input borders, chart axes; never essential text |
| `accent` | `oklch(0.58 0.155 196)` | Focus rings, active states, the series in focus |
| `warn` | `#b0700f` | Regulatory and deadline callouts, held payments |
| `good` / `good-tint` | `#2f7a4b` / `#e3f1e6` | Approved and paid |
| `bad` / `bad-tint` | `#a3341c` / `#f6e1dc` | Declined |
| `info` / `info-tint` | `#2c6a8f` / `#e2eff5` | Waiting and in progress |
| `refer` / `refer-tint` | `#6b4fa3` / `#ece6f6` | Referred to a person, with a handler |
| `accent-tint` | `#def2f2` | Call-to-action bars, chosen tiles' icons |

1. Type: Geist 600 for headings and numbers, Inter for body, Geist Mono uppercase for labels. App sizes: `h1` 2rem, `h2` 1.5rem, `h3` 1.14rem, body 1rem, tables 0.92rem.
2. Spacing on the 8px scale (4–48px); radii 6px for tags, 14px for cards, pills for buttons. Cards take a 1px `line`; `shadow` is for menus and dialogs only.

## Rules

3. Calm and precise: no hype, emoji, gradients or scroll reveals; `accent` used sparingly.
4. Use the system's Button, Badge, Card, Eyebrow, Input and Logo. Code uses the tokens as CSS variables (`var(--ink)`), never raw values; anything new is built from them and added back to the system once settled.
5. Icons: Lucide outline, stroke 2, `currentColor`; decorative icons are `aria-hidden`, and icon-only buttons have a label.
6. Fonts are self-hosted `woff2` files served with the app, so no request leaves for a font CDN.
7. WCAG 2.2 AA (code-standards 16): text 4.5:1, controls and focus rings 3:1; targets at least 24×24px; sticky parts never hide the focused element; sign-in allows paste and password managers.
8. Status is a word plus an icon, never colour alone. Motion is 0.2s at most, and none under `prefers-reduced-motion`.
9. Words: Australian English and sentence case; buttons say what happens ("Sign off and pay"); errors say what to do next.
10. AI output is labelled: show what the agent decided, its reasons and sources, and how to ask for a person to review it (the Privacy Act's automated decision rules, business 3).

## This project

11. Premium and quiet: a `bg-ink` header band with the logo, generous space on paper, and key numbers set large in Geist.
12. Queue: a strip of four figures (waiting, waiting for sign-off, decided, paid so far) with mono labels, then the claims table.
13. Claim page: on the left, the customer's story, the items and documents, and the agent's steps as a timeline (screened, looked up, decided, paid); on the right, a sticky decision card with the outcome, the payout, the section relied on and the sources.
14. Payout bar: one horizontal bar from claimed to paid, with the deductible and anything over a limit in `bg-3`, the paid amount in `accent`, and every segment labelled.
15. Every screen has loading skeletons in its own layout, an empty state that says what to do, and an error state with a retry.
16. Status chips: Waiting, In progress, Waiting for sign-off, Sent back, Approved, Declined, Referred and Paid; `warn` only for a payment held over the limit.
17. Numbers in tabular figures; money always shows 2 decimal places in US dollars (`$1,234.50`, spec 41). Dates as `8 Nov 2026`.

## Added components

18. Status tones: a chip's tint sits behind dark `ink` text (4.5:1); the tone colours only its icon and edge, so colour is never the only signal. The same tones run through both apps and the queue's figure cards.
19. Layered cards: a 1px `line` border, an inner highlight and a soft lift shadow; clickable cards lift slightly on hover.
20. Header: the `bg-ink` band with a 3px `accent` edge underneath.
21. Choice tiles and trip cards: large radio cards with an icon in an `accent-tint` square; the chosen one takes a 2px `accent` ring.
22. Day picker: the days of the trip as tappable pills, with a list of days for trips over three weeks; never a typed `mm/dd/yyyy` date.
23. Action bar: a slim `accent-tint` bar under the stage tracker with one call to action, in place of an empty card.
24. Motion: transitions of 0.18s on colour, shadow and a 1px lift; none under `prefers-reduced-motion`.
