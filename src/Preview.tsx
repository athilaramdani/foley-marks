import { useEffect, useRef, type RefObject } from "react";
import type { Project, Clip } from "./model";
import { mediaUrl } from "./bridge";
import { useEditor } from "./store";
function location(c: Clip, time: number) {
  let x = Number(c.x ?? 0.5),
    y = Number(c.y ?? 0.5);
  const age =
    (time - c.start_time + Number(c.animation_offset ?? c.source_offset)) /
    Number(c.animation_duration ?? c.duration);
  const points = c.tracking as
    | { time: number; x: number; y: number }[]
    | undefined;
  if (c.tracking_mode === "spawn_release") {
    x += 0.18 * age * Number(c.direction ?? 1);
    y -= 0.08 * age;
  }
  if (c.tracking_mode === "body_follow" && points?.length) {
    if (
      time < Number(c.tracking_visible_start ?? points[0].time - 0.4) ||
      time > Number(c.tracking_visible_end ?? points.at(-1)!.time + 0.4)
    )
      return null;
    const b = points.find((p) => p.time >= time) || points.at(-1)!,
      a = [...points].reverse().find((p) => p.time <= time) || points[0];
    const f = Math.max(
      0,
      Math.min(1, (time - a.time) / Math.max(0.001, b.time - a.time)),
    );
    x = a.x + (b.x - a.x) * f + Number(c.anchor_dx ?? 0);
    y = a.y + (b.y - a.y) * f + Number(c.anchor_dy ?? 0);
  }
  return { x, y, age };
}
export function Preview({
  video,
  project,
  quality,
}: {
  video: RefObject<HTMLVideoElement | null>;
  project: Project;
  quality: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = video.current,
      canvas = ref.current,
      ctx = canvas?.getContext("2d");
    if (!el || !canvas || !ctx) return;
    let alive = true,
      frame = 0,
      last = -1,
      invalid = true;
    const tr = project.video_transform ?? {},
      r = tr.rotation || 0,
      sideways = r % 180 !== 0;
    const imgs = new Map<string, HTMLImageElement>();
    const visually = project.tracks
      .filter((t) => t.media_type === "visual" && t.is_visible && !t.is_muted)
      .flatMap((t) => t.clips)
      .filter((c) => !c.is_muted && c.review_status !== "rejected")
      .sort((a, b) => Number(a.layer || 0) - Number(b.layer || 0));
    for (const c of visually) {
      if (c.effect === "sticker")
        mediaUrl(c.file_path)
          .then((url) => {
            if (!alive) return;
            const img = new Image();
            img.onload = () => {
              invalid = true;
            };
            img.src = url;
            imgs.set(c.clip_id, img);
          })
          .catch(() => {});
    }
    const obs = new ResizeObserver(() => {
      invalid = true;
    });
    obs.observe(canvas.parentElement!);
    function draw() {
      frame = requestAnimationFrame(draw);
      if (
        !el ||
        !canvas ||
        !ctx ||
        el.readyState < 2 ||
        (!invalid && last === el.currentTime)
      )
        return;
      last = el.currentTime;
      invalid = false;
      const sw = el.videoWidth,
        sh = el.videoHeight,
        w = tr.width || (sideways ? sh : sw),
        h = tr.height || (sideways ? sw : sh);
      if (!w || !h) return;
      const ratio =
        Math.min(
          1,
          ((canvas.parentElement?.clientWidth || w) * devicePixelRatio) / w,
          ((canvas.parentElement?.clientHeight || h) * devicePixelRatio) / h,
        ) * (quality === "half" ? 0.5 : 1);
      const cw = Math.max(1, Math.round(w * ratio)),
        ch = Math.max(1, Math.round(h * ratio));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.fillStyle = "#090b0d";
      ctx.fillRect(0, 0, cw, ch);
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.scale(tr.flip_horizontal ? -1 : 1, tr.flip_vertical ? -1 : 1);
      ctx.rotate((r * Math.PI) / 180);
      const dw = sideways ? ch : cw,
        dh = sideways ? cw : ch,
        scale =
          tr.fit === "cover"
            ? Math.max(dw / sw, dh / sh)
            : Math.min(dw / sw, dh / sh);
      const x = tr.fit === "stretch" ? dw : sw * scale,
        y = tr.fit === "stretch" ? dh : sh * scale;
      ctx.drawImage(el, -x / 2, -y / 2, x, y);
      ctx.restore();
      const time = useEditor.getState().playhead;
      for (const c of visually) {
        if (time < c.start_time || time >= c.start_time + c.duration) continue;
        const at = location(c, time);
        if (!at) continue;
        const size = cw * Number(c.scale ?? 0.2);
        ctx.save();
        ctx.translate(cw * at.x, ch * at.y);
        ctx.rotate((-Number(c.rotation || 0) * Math.PI) / 180);
        ctx.globalAlpha = Number(c.opacity ?? 1);
        ctx.scale(size / 192, size / 192);
        const img = imgs.get(c.clip_id);
        if (img && img.complete && img.naturalWidth) {
          const h = (192 * img.naturalHeight) / img.naturalWidth;
          ctx.drawImage(img, -96, -h / 2, 192, h);
        } else if (c.effect === "exclamation") {
          ctx.fillStyle = "#ffdf46";
          ctx.strokeStyle = "#322614";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.roundRect(-15, -81, 30, 111, 10);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 62, 15, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        } else if (c.effect !== "sticker") {
          ctx.globalAlpha *= 0.82 * (1 - Math.min(1, at.age));
          ctx.fillStyle = c.effect === "fart_smoke" ? "#becd8c" : "#e0d3b9";
          ctx.strokeStyle = "#645e49";
          ctx.lineWidth = 2;
          for (const [i, [x, y]] of [
            [-31, 19],
            [14, 19],
            [-3, -16],
            [37, -13],
            [-42, -20],
          ].entries()) {
            ctx.beginPath();
            ctx.arc(
              x,
              y,
              (20 + 18 * Math.min(at.age, 1)) *
                (1 + 0.1 * Math.sin((time - c.start_time) * 8 + i)),
              0,
              Math.PI * 2,
            );
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    frame = requestAnimationFrame(draw);
    return () => {
      alive = false;
      obs.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [project, video, quality]);
  return <canvas className="picture" ref={ref} aria-label="Video preview" />;
}
