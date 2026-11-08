// A decorative travel scene for the sign-in page: a coastline under a sunset, a plane on a
// dashed flight path, a palm, a suitcase, an umbrella and a settled claim. Drawn in the brand
// tokens through CSS classes; hidden from assistive technology, since it carries no information.
export function TravelIllustration() {
  return (
    <svg
      className="illustration"
      viewBox="0 0 420 320"
      aria-hidden="true"
      focusable="false"
      role="presentation"
    >
      <rect className="il-sky" x="10" y="10" width="400" height="290" rx="28" />
      <circle className="il-sun-glow" cx="348" cy="96" r="46" />
      <circle className="il-sun" cx="348" cy="96" r="28" />
      <path
        className="il-cloud"
        d="M70 92a18 18 0 0 1 34-8 14 14 0 0 1 22 10h-56zM262 120a14 14 0 0 1 26-6 11 11 0 0 1 17 8h-43z"
      />
      <path className="il-orbit" d="M40 200C90 90 210 50 300 70s90 40 110 70" />
      <g className="il-plane" transform="translate(196 58) rotate(-14)">
        <path d="M0 0l32-5 11-11 5 2-5 12 15-2 5-7 4 2-3 8 3 8-4 2-5-7-15-2 5 12-5 2-11-11z" />
      </g>
      <path
        className="il-sea"
        d="M10 214c60-14 120-14 200 0s140 14 200 0v58a28 28 0 0 1-28 28H38a28 28 0 0 1-28-28z"
      />
      <path
        className="il-wave"
        d="M60 248c14-8 28-8 42 0M250 262c14-8 28-8 42 0M150 280c12-7 24-7 36 0"
      />
      <path className="il-land" d="M10 222c40-26 90-34 140-20 30 8 50 20 60 34H10z" />
      <path className="il-land-2" d="M232 232c30-24 90-30 178-14v18H232z" />
      <path className="il-palm" d="M96 214c4-36 8-60 22-84" />
      <path
        className="il-palm-leaf"
        d="M118 130c-18-12-40-10-52 2 18-4 34 0 46 8zM118 130c6-20 24-30 42-26-14 6-26 14-34 26zM118 130c18-6 36 2 44 16-14-8-28-12-42-10zM118 130c-8-16-26-24-42-20 14 4 26 12 34 22z"
      />
      <g transform="translate(300 196)">
        <path
          className="il-umbrella"
          d="M-44 12c4-30 24-46 44-46s40 16 44 46c-8-7-17-7-22 0-6-7-16-7-22 0-6-7-16-7-22 0-5-7-14-7-22 0z"
        />
        <path className="il-umbrella-stem" d="M0 12v44a8 8 0 0 1-16 0" />
      </g>
      <g transform="translate(176 196)">
        <path className="il-case-handle" d="M18 0v-10a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6V0" />
        <rect className="il-case" width="68" height="54" rx="10" />
        <path className="il-case-band" d="M0 18h68M0 34h68" />
      </g>
      <g transform="translate(40 40)">
        <rect className="il-card" width="88" height="70" rx="12" />
        <path className="il-card-line" d="M16 24h40M16 42h28" />
        <circle className="il-check" cx="68" cy="50" r="13" />
        <path className="il-check-mark" d="M62 50l4 4 8-9" />
      </g>
    </svg>
  );
}
