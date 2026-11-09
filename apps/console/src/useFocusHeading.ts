import { useEffect, useRef } from "react";

// Moves focus to a page's heading when the page opens, so keyboard and screen-reader users
// land at the top of the new page instead of on the link they followed.
export function useFocusHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
