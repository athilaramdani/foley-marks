import { useEffect, useRef, useState } from "react";
import { call } from "./bridge";
const pending = new Map<string, Promise<number[]>>();
export function Waveform({
  path,
  offset = 0,
  duration,
  total,
  enabled = true,
}: {
  path: string;
  offset?: number;
  duration: number;
  total?: number;
  enabled?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    const node = canvas.current;
    if (!node || !path || !enabled) return;
    let alive = true;
    const observe = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observe.disconnect();
      let req = pending.get(path);
      if (!req) {
        req = call<number[]>("waveform", { path });
        pending.set(path, req);
        if (pending.size > 100) pending.delete(pending.keys().next().value!);
      }
      req
        .then((data) => {
          if (alive) setPeaks(data);
        })
        .catch(() => pending.delete(path));
    });
    observe.observe(node);
    return () => {
      alive = false;
      observe.disconnect();
    };
  }, [path, enabled]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    function draw() {
      if (!c) return;
      const w = c.clientWidth,
        h = c.clientHeight,
        dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.min(8192, w * dpr);
      c.height = h * dpr;
      const ctx = c.getContext("2d");
      if (!ctx || !w || !h || !enabled) return;
      ctx.scale(c.width / w, dpr);
      ctx.fillStyle = getComputedStyle(c).color;
      const d = total || duration + offset;
      for (let x = 0; x < w; x += 3) {
        const idx = Math.floor(
          ((offset + (x / w) * duration) / d) * peaks.length,
        );
        const height = (peaks[idx] || 0) * h;
        if (height > 0) ctx.fillRect(x, (h - height) / 2, 2, height);
      }
    }
    const obs = new ResizeObserver(draw);
    obs.observe(c);
    draw();
    return () => obs.disconnect();
  }, [peaks, offset, duration, total, enabled]);
  return (
    <canvas className="waveform" ref={canvas} aria-label="Audio waveform" />
  );
}
