"use client";

import { useEffect, useRef, useState } from "react";
import { A4_PX } from "@/lib/documents/page-settings";

/**
 * Shrinks a sheet of paper to fit the space it is in (never enlarges it), so the whole page is visible with no
 * sideways scrolling. Read-only views use it; it uses CSS zoom, which changes the layout size and not just the look.
 */
export function FitWidth({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / A4_PX.width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="w-full">
      <div style={{ zoom: scale }} className="mx-auto w-fit">
        {children}
      </div>
    </div>
  );
}
