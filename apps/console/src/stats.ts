/** The likely range of a share measured on a few claims: the Wilson score interval at 95%.
 * It stays honest near 0% and 100%, where a small test set's scores sit: 5 of 5 right reads
 * "57% to 100%", not "100%". */
export function wilson(share: number, claims: number): [low: number, high: number] | null {
  if (claims <= 0) return null;
  const z = 1.96;
  const right = Math.round(share * claims);
  const p = right / claims;
  const zz = z * z;
  const centre = (p + zz / (2 * claims)) / (1 + zz / claims);
  const spread =
    (z * Math.sqrt((p * (1 - p)) / claims + zz / (4 * claims * claims))) / (1 + zz / claims);
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)];
}

/** A range as people read it: "65–94%". */
export function rangeText(range: [number, number] | null): string {
  if (range === null) return "–";
  const [low, high] = range.map((value) => Math.round(value * 100));
  return `${String(low)}–${String(high)}%`;
}
