import { useRef, useState, useEffect, type PointerEvent } from "react";
import {
  AudioLines,
  Film,
  Layers,
  LockKeyhole,
  LockKeyholeOpen,
  Volume2,
  VolumeX,
  MousePointer2,
  Scissors,
  Magnet,
  Minus,
  Plus,
  Repeat2,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { useEditor } from "./store";
import {
  endTime,
  clamp,
  snap,
  newTrack,
  updateClip,
  type Clip,
  type Track,
  type Entry,
} from "./model";
import { soundPath } from "./bridge";
import { Waveform } from "./Waveform";
import { Icon } from "./controls";
interface Props {
  seek: (t: number) => void;
  add: (e: Entry, time: number, track: string) => void;
  split: () => void;
  remove: () => void;
  reorder: (id: string, time: number) => void;
  wave: boolean;
  label: string;
}
const labelWidth = 154;
export function Timeline({
  seek,
  add,
  split,
  remove,
  reorder,
  wave,
  label,
}: Props) {
  const p = useEditor((s) => s.project),
    pos = useEditor((s) => s.playhead),
    selected = useEditor((s) => s.selected),
    edit = useEditor((s) => s.edit);
  const scroll = useRef<HTMLDivElement>(null),
    [viewport, setViewport] = useState({ left: 0, width: 1200 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    start: number;
    length: number;
  } | null>(null);
  const zoom = clamp(p.zoom_level || 60, 5, 220),
    length = endTime(p),
    width = Math.max(viewport.width - labelWidth, (length || 12) * zoom + 48);
  const zoomBy = (n: number) =>
    edit((d) => {
      d.zoom_level = clamp(zoom * n, 5, 220);
    });
  const gap =
    [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((n) => n * zoom >= 60) ||
    300;
  const first = Math.max(0, Math.floor(viewport.left / zoom / gap) - 1);
  const ticks = Array.from(
    { length: Math.ceil(viewport.width / zoom / gap) + 3 },
    (_, i) => (i + first) * gap,
  );
  const timeAt = (client: number) =>
    clamp(
      ((scroll.current?.scrollLeft || 0) +
        client -
        (scroll.current?.getBoundingClientRect().left || 0) -
        labelWidth) /
        zoom,
      0,
      length,
    );
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const obs = new ResizeObserver(() =>
      setViewport({ left: el.scrollLeft, width: el.clientWidth }),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const scrub = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX));
    const move = (ev: globalThis.PointerEvent) => seek(timeAt(ev.clientX));
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("lostpointercapture", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("lostpointercapture", end);
  };
  function dragClip(e: PointerEvent, clip: Clip, track: Track) {
    e.stopPropagation();
    useEditor.setState({ selected: clip.clip_id });
    if (track.is_locked || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement,
      initial = e.clientX,
      rect = el.getBoundingClientRect();
    const edge =
      track.media_type === "video"
        ? "move"
        : e.clientX - rect.left < 6
          ? "left"
          : rect.right - e.clientX < 6
            ? "right"
            : "move";
    el.setPointerCapture(e.pointerId);
    const state = (client: number) => {
      const delta = (client - initial) / zoom,
        start = clip.start_time,
        end = start + clip.duration;
      if (edge === "left") {
        const n = clamp(
          snap(p, start + delta, clip.clip_id, pos),
          Math.max(0, start - clip.source_offset),
          end - 0.01,
        );
        return { start: n, length: end - n };
      }
      if (edge === "right") {
        const length = clamp(
          snap(p, end + delta, clip.clip_id, pos) - start,
          0.01,
          (clip.source_duration ?? clip.duration + clip.source_offset) -
            clip.source_offset,
        );
        return { start, length };
      }
      return {
        start: snap(p, start + delta, clip.clip_id, pos),
        length: clip.duration,
      };
    };
    const move = (ev: globalThis.PointerEvent) => {
      if (Math.abs(ev.clientX - initial) > 2)
        setDrag({ id: clip.clip_id, ...state(ev.clientX) });
    };
    const cleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cleanup);
      setDrag(null);
    };
    const up = (ev: globalThis.PointerEvent) => {
      cleanup();
      if (Math.abs(ev.clientX - initial) < 3) return;
      const { start, length: duration } = state(ev.clientX);
      if (track.media_type === "video") {
        reorder(clip.clip_id, start);
        return;
      }
      const destination = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>("[data-track]")?.dataset.track;
      edit((d) => {
        if (
          !updateClip(d, clip.clip_id, {
            start_time: start,
            duration,
            source_offset:
              clip.source_offset +
              (edge === "left" ? start - clip.start_time : 0),
          })
        )
          return false;
        if (destination && edge === "move" && track.track_id !== destination) {
          const dest = d.tracks.find(
            (t) =>
              t.track_id === destination &&
              t.media_type === track.media_type &&
              !t.is_locked,
          );
          const src = d.tracks.find((t) => t.track_id === track.track_id)!;
          if (dest) {
            const index = src.clips.findIndex(
              (c) => c.clip_id === clip.clip_id,
            );
            dest.clips.push(...src.clips.splice(index, 1));
            dest.clips.sort((a, b) => a.start_time - b.start_time);
          }
        }
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cleanup);
  }
  function toggle(t: Track, key: "is_locked" | "is_visible" | "is_muted") {
    edit((d) => {
      const row = d.tracks.find((x) => x.track_id === t.track_id)!;
      row[key] = !row[key];
    });
  }
  return (
    <section className="timeline panel">
      <div className="panel-heading timeline-head">
        <div className="panel-name">
          <Layers size={15} />
          {label}
        </div>
        <span className="head-divider" />
        <Icon label="Select clip" active>
          <MousePointer2 />
        </Icon>
        <Icon
          label="Split at playhead (S)"
          onClick={split}
          disabled={!selected}
        >
          <Scissors />
        </Icon>
        <Icon label="Delete clip" onClick={remove} disabled={!selected}>
          <Trash2 />
        </Icon>
        <Icon
          label="Snap (N)"
          active={p.snapping_enabled}
          onClick={() =>
            edit((d) => {
              d.snapping_enabled = !d.snapping_enabled;
            })
          }
        >
          <Magnet />
        </Icon>
        <Icon
          label="Loop playback"
          active={p.looping_enabled}
          onClick={() =>
            edit((d) => {
              d.looping_enabled = !d.looping_enabled;
            })
          }
        >
          <Repeat2 />
        </Icon>
        <div className="spacer" />
        <button
          className="text-action"
          onClick={() =>
            edit((d) => {
              d.tracks.push(
                newTrack(
                  "audio",
                  "SFX " +
                    (d.tracks.filter((t) => t.media_type === "audio").length +
                      1),
                ),
              );
            })
          }
        >
          <Plus size={14} /> Track
        </button>
        <span className="head-divider" />
        <Icon label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus />
        </Icon>
        <input
          aria-label="Timeline zoom"
          className="zoom"
          type="range"
          min="5"
          max="220"
          value={zoom}
          onChange={(e) =>
            edit((d) => {
              d.zoom_level = +e.target.value;
            })
          }
        />
        <Icon label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus />
        </Icon>
      </div>
      <div
        className="tracks-scroll"
        ref={scroll}
        onScroll={(e) =>
          setViewport({
            left: e.currentTarget.scrollLeft,
            width: e.currentTarget.clientWidth,
          })
        }
      >
        <div className="track-content" style={{ width: width + labelWidth }}>
          <div className="track-row ruler">
            <div className="track-label">TRACKS</div>
            <div className="ruler-ticks" onPointerDown={scrub}>
              {ticks
                .filter((n) => n * zoom < width)
                .map((n) => (
                  <span key={n} style={{ left: n * zoom }}>
                    {Math.floor(n / 60)}:
                    {String(Math.floor(n) % 60).padStart(2, "0")}
                    {n % 1 ? ".5" : ""}
                  </span>
                ))}
            </div>
          </div>
          {p.tracks.map((t, i) => (
            <div key={t.track_id} className="track-row" data-track={t.track_id}>
              <div className="track-label">
                <div className={"track-badge " + t.media_type}>
                  {t.media_type === "video"
                    ? "V"
                    : t.media_type === "visual"
                      ? "FX"
                      : "A"}
                  {
                    p.tracks
                      .slice(0, i + 1)
                      .filter((x) => x.media_type === t.media_type).length
                  }
                </div>
                <strong title={t.name}>{t.name}</strong>
                <div className="track-actions">
                  <Icon
                    label={t.is_locked ? "Unlock track" : "Lock track"}
                    active={t.is_locked}
                    onClick={() => toggle(t, "is_locked")}
                  >
                    {t.is_locked ? <LockKeyhole /> : <LockKeyholeOpen />}
                  </Icon>
                  <Icon
                    label={t.is_muted ? "Unmute track" : "Mute track"}
                    active={t.is_muted}
                    onClick={() => toggle(t, "is_muted")}
                  >
                    {t.is_muted ? <VolumeX /> : <Volume2 />}
                  </Icon>
                  <Icon
                    label="Track visibility"
                    onClick={() => toggle(t, "is_visible")}
                  >
                    {t.is_visible ? <Eye /> : <EyeOff />}
                  </Icon>
                </div>
              </div>
              <div
                className="lane"
                style={{ backgroundSize: gap * zoom + "px 100%" }}
                onPointerDown={scrub}
                onDragOver={(e) => {
                  if (t.media_type === "audio" && !t.is_locked)
                    e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const e2: Entry = JSON.parse(
                      e.dataTransfer.getData("application/x-foley-sfx"),
                    );
                    add(e2, snap(p, timeAt(e.clientX)), t.track_id);
                  } catch {
                    /* Foreign drag. */
                  }
                }}
              >
                {t.is_visible &&
                  t.clips
                    .filter(
                      (c) =>
                        (c.start_time * zoom <
                          viewport.left + viewport.width + 200 &&
                          (c.start_time + c.duration) * zoom >
                            viewport.left - 200) ||
                        c.clip_id === drag?.id,
                    )
                    .map((c) => (
                      <div
                        key={c.clip_id}
                        title={c.name}
                        role="button"
                        tabIndex={0}
                        aria-label={c.name}
                        onFocus={() =>
                          useEditor.setState({ selected: c.clip_id })
                        }
                        className={[
                          "clip",
                          c.media_type,
                          selected === c.clip_id ? "selected" : "",
                          t.is_muted || c.is_muted ? "muted" : "",
                        ].join(" ")}
                        style={{
                          left:
                            (drag?.id === c.clip_id
                              ? drag.start
                              : c.start_time) * zoom,
                          width: Math.max(
                            4,
                            (drag?.id === c.clip_id
                              ? drag.length
                              : c.duration) * zoom,
                          ),
                        }}
                        onPointerDown={(e) => dragClip(e, c, t)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          useEditor.setState({ selected: c.clip_id });
                          setMenu({
                            x: e.clientX,
                            y: Math.min(e.clientY, window.innerHeight - 110),
                          });
                        }}
                      >
                        <span>
                          {c.media_type === "video" ? (
                            <Film size={12} />
                          ) : (
                            <AudioLines size={12} />
                          )}{" "}
                          {c.name}
                        </span>
                        {c.media_type === "audio" && (
                          <Waveform
                            path={soundPath(p, c.file_path)}
                            duration={c.duration}
                            total={c.source_duration}
                            offset={c.source_offset}
                            enabled={wave}
                          />
                        )}
                      </div>
                    ))}
              </div>
            </div>
          ))}
          <div className="playhead" style={{ left: labelWidth + pos * zoom }}>
            <i />
          </div>
        </div>
      </div>
      {menu && (
        <div
          className="menu context"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              split();
              setMenu(null);
            }}
          >
            Split at playhead <kbd>S</kbd>
          </button>
          <button
            onClick={() => {
              remove();
              setMenu(null);
            }}
          >
            Delete clip <kbd>Del</kbd>
          </button>
        </div>
      )}
    </section>
  );
}
