// A decorative travel scene for the sign-in page: a globe with a flight path, a plane, a
// suitcase and an umbrella. Drawn in the design tokens through CSS classes; hidden from
// assistive technology, since it carries no information.
export function TravelIllustration() {
  return (
    <svg
      className="illustration"
      viewBox="0 0 420 320"
      aria-hidden="true"
      focusable="false"
      role="presentation"
    >
      <circle className="il-sun" cx="330" cy="70" r="34" />
      <circle className="il-globe" cx="190" cy="185" r="110" />
      <path
        className="il-land"
        d="M118 120c18-14 40-12 52 2 10 12 4 26-10 30-16 4-20 18-10 30 8 10-2 24-18 22-22-3-36-24-36-46 0-16 8-30 22-38zM222 98c20-6 46 2 58 20 8 12-2 22-14 20-14-2-24 8-20 22 4 16-12 24-24 16-14-10-16-30-14-46 2-14 4-28 14-32zM236 216c14-4 30 4 34 18 3 12-8 22-22 22-16 0-26-12-24-24 1-8 5-14 12-16z"
      />
      <path className="il-orbit" d="M58 210c40-110 220-170 330-110" fill="none" />
      <g className="il-plane" transform="translate(338 94) rotate(28)">
        <path d="M-26 0h40c6 0 10 2 10 4s-4 4-10 4h-40z" />
        <path d="M-4 4l-10 18h7l16-18z" />
        <path d="M-4 0l-10-16h7l16 16z" />
        <path d="M-24 2l-6-9h5l8 9z" />
      </g>
      <g className="il-case" transform="translate(70 214)">
        <rect width="78" height="60" rx="9" />
        <path className="il-case-band" d="M0 22h78M0 38h78" />
        <path
          className="il-case-handle"
          d="M26 0v-9a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v9"
          fill="none"
        />
      </g>
      <g className="il-umbrella" transform="translate(300 196)">
        <path d="M-52 18c6-30 28-48 52-48s46 18 52 48c-8-7-17-7-26 0-8-7-18-7-26 0-8-7-18-7-26 0-9-7-18-7-26 0z" />
        <path className="il-umbrella-stem" d="M0 18v52a9 9 0 0 1-18 0" fill="none" />
      </g>
      <path
        className="il-cloud"
        d="M44 92a16 16 0 0 1 30-8 12 12 0 0 1 20 10h-50a10 10 0 0 1 0-2z"
      />
      <g className="il-receipt" transform="translate(150 40)">
        <rect className="il-card" width="96" height="112" rx="12" />
        <path className="il-card-line" d="M18 30h44M18 50h60M18 70h36" />
        <circle className="il-check" cx="78" cy="94" r="16" />
        <path className="il-check-mark" d="M71 94l5 5 9-10" />
      </g>
      <path className="il-spark" d="M268 40l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" />
      <path className="il-ground" d="M20 290h380" />
    </svg>
  );
}
