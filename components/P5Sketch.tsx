"use client";

import { useEffect, useRef } from "react";

type P5SketchProps = {
  code: string;
};

type P5Instance = {
  remove: () => void;
};

export function P5Sketch({ code }: P5SketchProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current || code.trim().length === 0) {
      return;
    }

    let instance: P5Instance | null = null;
    let cancelled = false;

    void (async () => {
      const p5Module = await import("p5");
      if (cancelled || !hostRef.current) {
        return;
      }

      const P5 = p5Module.default as unknown as new (
        sketch: (p: Record<string, unknown>) => void,
        node: HTMLElement,
      ) => P5Instance;
      const sketch = (p: Record<string, unknown>) => {
        const runtime = new Function(
          "p",
          `with (p) { ${code}\nreturn { setup: typeof setup === "function" ? setup : null, draw: typeof draw === "function" ? draw : null }; }`,
        ) as (p: Record<string, unknown>) => {
          setup: (() => void) | null;
          draw: (() => void) | null;
        };

        const exported = runtime(p);

        if (exported.setup) {
          (p as { setup?: () => void }).setup = exported.setup;
        }

        if (exported.draw) {
          (p as { draw?: () => void }).draw = exported.draw;
        }
      };

      instance = new P5(sketch, hostRef.current);
    })();

    return () => {
      cancelled = true;
      instance?.remove();
      instance = null;
    };
  }, [code]);

  return <div ref={hostRef} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white" />;
}
