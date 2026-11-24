import {
  AudioLines,
  Film,
  SlidersHorizontal,
  Link2,
  ListMusic,
  Plus,
  CheckCheck,
  ScanLine,
} from "lucide-react";
import { useState } from "react";
import { Field, NumberField } from "./controls";
import { Button } from "./components/ui/button";
import { useEditor } from "./store";
import {
  basename,
  formatTime,
  updateClip,
  endTime,
  type Clip,
  type Project,
} from "./model";
export function Inspector({
  relink,
  analyze,
  addVisual,
  label,
  seek,
}: {
  relink: (c?: Clip) => void;
  analyze: () => void;
  addVisual: (sticker?: boolean) => void;
  label: string;
  seek: (n: number) => void;
}) {
  const p = useEditor((s) => s.project),
    id = useEditor((s) => s.selected),
    edit = useEditor((s) => s.edit);
  const [tab, setTab] = useState("clip");
  const track = p.tracks.find((t) => t.clips.some((c) => c.clip_id === id)),
    c = track?.clips.find((c) => c.clip_id === id);
  const field = (v: Partial<Clip>) =>
    !!c && edit((d) => updateClip(d, c.clip_id, v));
  const transform = (k: string, v: unknown) =>
    edit((d) => {
      d.video_transform = { ...d.video_transform, [k]: v };
    });
  const audios = p.tracks
    .filter((t) => t.media_type === "audio")
    .flatMap((t) => t.clips)
    .sort((a, b) => a.start_time - b.start_time);
  return (
    <section className="inspector panel">
      <div className="panel-heading">
        <div className="panel-name">
          <SlidersHorizontal size={15} />
          {label}
        </div>
      </div>
      <div className="tabs">
        <button
          onClick={() => setTab("clip")}
          className={tab === "clip" ? "on" : ""}
        >
          Properties
        </button>
        <button
          onClick={() => setTab("notes")}
          className={tab === "notes" ? "on" : ""}
        >
          Annotations {audios.length > 0 && <small>{audios.length}</small>}
        </button>
      </div>
      <div className="inspector-body">
        {tab === "notes" ? (
          <>
            <div className="section-label">Sound cues</div>
            {!audios.length && (
              <p className="muted-text">
                Placed sound effects appear here for review.
              </p>
            )}
            {audios.map((a) => (
              <button
                className="cue-list"
                key={a.clip_id}
                onClick={() => {
                  useEditor.setState({ selected: a.clip_id });
                  seek(a.start_time);
                  setTab("clip");
                }}
              >
                <ListMusic size={14} />
                <span>{a.name}</span>
                <time>
                  {formatTime(a.start_time, p.video_info.fps).slice(3)}
                </time>
              </button>
            ))}
          </>
        ) : (
          <>
            {c && track ? (
              <>
                <div className="item-title">
                  {c.media_type === "video" ? <Film /> : <AudioLines />}
                  <strong>{c.name}</strong>
                </div>
                {c.missing_media && (
                  <p className="warning">
                    Missing media · relink the source to preview and export.
                  </p>
                )}
                <fieldset disabled={track.is_locked}>
                  <Field label="Clip name">
                    <input
                      key={c.clip_id + c.name}
                      defaultValue={c.name}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value !== c.name)
                          field({ name: e.target.value.trim() });
                      }}
                    />
                  </Field>
                  {c.media_type !== "video" && (
                    <>
                      <div className="field-grid">
                        <NumberField
                          label="Start (s)"
                          value={c.start_time}
                          change={(v) => field({ start_time: v })}
                        />
                        <NumberField
                          label="Duration (s)"
                          value={c.duration}
                          min={0.001}
                          max={
                            c.source_duration === undefined
                              ? undefined
                              : c.source_duration - c.source_offset
                          }
                          change={(v) => field({ duration: v })}
                        />
                      </div>
                      <NumberField
                        label="Source offset (s)"
                        value={c.source_offset}
                        max={
                          c.source_duration === undefined
                            ? undefined
                            : c.source_duration - c.duration
                        }
                        change={(v) => field({ source_offset: v })}
                      />
                    </>
                  )}
                  {c.media_type === "audio" && (
                    <>
                      <label className="toggle-row">
                        Mute clip
                        <input
                          type="checkbox"
                          checked={!!c.is_muted}
                          onChange={(e) =>
                            field({ is_muted: e.target.checked })
                          }
                        />
                      </label>
                      <div className="range-label">
                        Clip volume <b>{Math.round((c.volume ?? 1) * 100)}%</b>
                      </div>
                      <input
                        type="range"
                        aria-label="Clip volume"
                        min="0"
                        max="100"
                        key={c.clip_id + String(c.volume)}
                        defaultValue={(c.volume ?? 1) * 100}
                        onPointerUp={(e) =>
                          field({ volume: +e.currentTarget.value / 100 })
                        }
                        onKeyUp={(e) =>
                          field({ volume: +e.currentTarget.value / 100 })
                        }
                      />
                      <Field label="Review status">
                        <select
                          value={c.review_status || "manual"}
                          onChange={(e) =>
                            field({ review_status: e.target.value })
                          }
                        >
                          {[
                            "manual",
                            "auto-generated",
                            "reviewed",
                            "approved",
                            "modified",
                            "rejected",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </Field>
                      {["category", "event_type", "subject_id"].map((key) => (
                        <Field key={key} label={key.replace("_", " ")}>
                          <input
                            key={c.clip_id + String(c[key])}
                            defaultValue={String(c[key] || "")}
                            onBlur={(e) => {
                              if (e.target.value !== String(c[key] || ""))
                                field({ [key]: e.target.value });
                            }}
                          />
                        </Field>
                      ))}
                      <Field label="Note">
                        <textarea
                          key={c.clip_id + String(c.notes)}
                          defaultValue={String(c.notes || "")}
                          onBlur={(e) => {
                            if (e.target.value !== String(c.notes || ""))
                              field({ notes: e.target.value });
                          }}
                        />
                      </Field>
                      <Button
                        onClick={() => field({ review_status: "approved" })}
                      >
                        <CheckCheck size={14} /> Approve cue
                      </Button>
                    </>
                  )}
                  {c.media_type === "visual" && (
                    <>
                      <Field label="Effect">
                        <select
                          value={String(c.effect || "dust")}
                          onChange={(e) => field({ effect: e.target.value })}
                        >
                          {[
                            "dust",
                            "jump_puff",
                            "exclamation",
                            "fart_smoke",
                            ...(c.file_path ? ["sticker"] : []),
                          ].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                      {["x", "y", "scale", "opacity"].map((k) => (
                        <NumberField
                          key={k}
                          label={k}
                          value={Number(
                            c[k] ??
                              { x: 0.5, y: 0.5, scale: 0.2, opacity: 1 }[
                                k as "x"
                              ],
                          )}
                          min={k === "scale" ? 0.01 : 0}
                          max={k === "scale" ? 2 : 1}
                          change={(v) => field({ [k]: v })}
                        />
                      ))}
                    </>
                  )}
                  {c.file_path && (
                    <Button variant="ghost" onClick={() => relink(c)}>
                      <Link2 size={14} />
                      Relink source
                    </Button>
                  )}
                </fieldset>
              </>
            ) : (
              <>
                <div className="section-label">Project</div>
                <div className="item-title">
                  <Film />
                  <strong>
                    {basename(p.video_path) || "Untitled sequence"}
                  </strong>
                </div>
              </>
            )}
            {(!c || c.media_type === "video") && (
              <>
                <dl className="specs">
                  <dt>Resolution</dt>
                  <dd>
                    {p.video_info.width
                      ? p.video_info.width + " × " + p.video_info.height
                      : "—"}
                  </dd>
                  <dt>Frame rate</dt>
                  <dd>
                    {p.video_path
                      ? (p.video_info.fps || 0).toFixed(2) + " fps"
                      : "—"}
                  </dd>
                  <dt>Duration</dt>
                  <dd>{formatTime(endTime(p), p.video_info.fps)}</dd>
                </dl>
                {p.video_path && (
                  <>
                    <Field label="Rotation">
                      <select
                        value={p.video_transform?.rotation || 0}
                        onChange={(e) => transform("rotation", +e.target.value)}
                      >
                        {[0, 90, 180, 270].map((n) => (
                          <option key={n} value={n}>
                            {n}°
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Output size">
                      <select
                        value={
                          p.video_transform?.width
                            ? String(p.video_transform.width) +
                              "x" +
                              p.video_transform.height
                            : "source"
                        }
                        onChange={(e) => {
                          const [width, height] =
                            e.target.value === "source"
                              ? [0, 0]
                              : e.target.value.split("x").map(Number);
                          edit((d) => {
                            d.video_transform = {
                              ...d.video_transform,
                              width,
                              height,
                            };
                          });
                        }}
                      >
                        {[
                          "source",
                          "1920x1080",
                          "1080x1920",
                          "1080x1080",
                          "1280x720",
                          ...(p.video_transform?.width
                            ? [
                                p.video_transform.width +
                                  "x" +
                                  p.video_transform.height,
                              ]
                            : []),
                        ]
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                      </select>
                    </Field>
                    <CustomSize
                      key={
                        String(p.video_transform?.width) +
                        ":" +
                        p.video_transform?.height
                      }
                      width={p.video_transform?.width || p.video_info.width}
                      height={p.video_transform?.height || p.video_info.height}
                      apply={(width, height) =>
                        edit((d) => {
                          d.video_transform = {
                            ...d.video_transform,
                            width,
                            height,
                          };
                        })
                      }
                    />
                    <Field label="Fit">
                      <select
                        value={p.video_transform?.fit || "contain"}
                        onChange={(e) => transform("fit", e.target.value)}
                      >
                        {["contain", "cover", "stretch"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    {["flip_horizontal", "flip_vertical"].map((k) => (
                      <label key={k} className="toggle-row">
                        <span>{k.replace("_", " ")}</span>
                        <input
                          type="checkbox"
                          checked={
                            !!p.video_transform?.[
                              k as keyof Project["video_transform"]
                            ]
                          }
                          onChange={(e) => transform(k, e.target.checked)}
                        />
                      </label>
                    ))}
                    <Button variant="ghost" onClick={() => relink()}>
                      <Link2 size={14} />
                      Relink video
                    </Button>
                  </>
                )}
              </>
            )}
            <div className="section-label block">Detection</div>
            <Field label="Cue density">
              <select
                value={String(p.analysis_settings.density || "high")}
                onChange={(e) =>
                  edit((d) => {
                    d.analysis_settings.density = e.target.value;
                  })
                }
              >
                {["low", "medium", "high"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Button disabled={!p.video_path} onClick={analyze}>
              <ScanLine size={15} /> Analyze motion
            </Button>
            <Button
              disabled={!p.video_path}
              variant="ghost"
              onClick={() => addVisual()}
            >
              <Plus size={14} /> Visual effect
            </Button>
            <Button
              disabled={!p.video_path}
              variant="ghost"
              onClick={() => addVisual(true)}
            >
              <Plus size={14} />
              Import sticker
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function CustomSize({
  width,
  height,
  apply,
}: {
  width: number;
  height: number;
  apply: (w: number, h: number) => void;
}) {
  const [w, setW] = useState(width),
    [h, setH] = useState(height);
  const valid = (n: number) =>
    Number.isInteger(n) && n >= 16 && n <= 7680 && n % 2 === 0;
  return (
    <details>
      <summary>Custom dimensions</summary>
      <div className="field-grid">
        <NumberField
          label="Width"
          value={w}
          min={16}
          max={7680}
          step={2}
          change={setW}
        />
        <NumberField
          label="Height"
          value={h}
          min={16}
          max={7680}
          step={2}
          change={setH}
        />
      </div>
      <Button disabled={!valid(w) || !valid(h)} onClick={() => apply(w, h)}>
        Apply dimensions
      </Button>
    </details>
  );
}
