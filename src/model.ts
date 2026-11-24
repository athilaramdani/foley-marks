export type Kind = "audio" | "video" | "visual";
export interface Clip {
  [key: string]: unknown;
  clip_id: string;
  name: string;
  file_path: string;
  category: string;
  media_type: Kind;
  start_time: number;
  duration: number;
  source_offset: number;
  source_duration?: number;
  volume?: number;
  review_status?: string;
  missing_media?: boolean;
  is_muted?: boolean;
}
export interface Track {
  [key: string]: unknown;
  track_id: string;
  name: string;
  media_type: Kind;
  clips: Clip[];
  is_locked: boolean;
  is_muted: boolean;
  is_visible: boolean;
}
export interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
}
export interface Project {
  [key: string]: unknown;
  schema_version: number;
  video_path: string;
  tracks: Track[];
  video_info: Probe;
  zoom_level: number;
  snapping_enabled: boolean;
  looping_enabled: boolean;
  video_volume: number;
  correction_history: Record<string, unknown>[];
  detected_events: Record<string, unknown>[];
  analysis_settings: Record<string, unknown>;
  sound_dir: string;
  video_edit_empty?: boolean;
  video_transform?: {
    width?: number;
    height?: number;
    rotation?: number;
    flip_horizontal?: boolean;
    flip_vertical?: boolean;
    fit?: string;
  };
}
export type Entry = {
  path: string;
  name: string;
  category: string;
  size: number;
};
export type Dataset = {
  videos: Entry[];
  sounds: Entry[];
  annotations: Entry[];
  bytes: number;
  missing: string[];
};
export const emptyDataset: Dataset = {
  videos: [],
  sounds: [],
  annotations: [],
  bytes: 0,
  missing: [],
};
export const basename = (path: string) =>
  path.replaceAll("\\", "/").split("/").pop() || path;
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const id = () => crypto.randomUUID();
export function newTrack(media_type: Kind, name: string): Track {
  return {
    track_id: id(),
    name,
    media_type,
    clips: [],
    is_muted: false,
    is_locked: false,
    is_visible: true,
  };
}
export function newClip(
  path: string,
  type: Kind,
  duration: number,
  start = 0,
): Clip {
  return {
    clip_id: id(),
    name: basename(path),
    file_path: path,
    media_type: type,
    start_time: start,
    duration,
    source_offset: 0,
    source_duration: duration,
    category: "",
    volume: 1,
  };
}
export function newProject(
  path = "",
  info: Probe = { duration: 0, fps: 30, width: 0, height: 0 },
): Project {
  const v = newTrack("video", "Picture");
  if (path) v.clips.push(newClip(path, "video", info.duration));
  return {
    schema_version: 3,
    schema_name: "video_sfx_annotation",
    video_path: path,
    video_info: info,
    tracks: [v, newTrack("audio", "Sound effects")],
    zoom_level: 60,
    video_volume: 0.8,
    snapping_enabled: true,
    looping_enabled: false,
    correction_history: [],
    detected_events: [],
    analysis_settings: {},
    sound_dir: "",
  };
}
export function hydrate(doc: Project): Project {
  if (!Array.isArray(doc.tracks))
    throw Error("This project could not be migrated to a track timeline.");
  const defaults = newProject();
  const result = {
    ...defaults,
    ...doc,
    video_info: { ...defaults.video_info, ...doc.video_info },
    tracks: doc.tracks.map((t) => ({
      ...t,
      is_locked: !!t.is_locked,
      is_visible: t.is_visible !== false,
      is_muted: !!t.is_muted,
      clips: t.clips.map((c) => ({
        ...c,
        source_offset: c.source_offset ?? 0,
        clip_id: c.clip_id || id(),
      })),
    })),
  };
  const video = result.tracks.find((t) => t.media_type === "video");
  if (
    video &&
    !video.clips.length &&
    !result.video_edit_empty &&
    result.video_path &&
    result.video_info.duration > 0
  )
    video.clips.push(
      newClip(result.video_path, "video", result.video_info.duration),
    );
  return result;
}
export function documentForSave(p: Project): Project {
  const annotations = p.tracks
    .filter((t) => t.media_type === "audio")
    .flatMap((t) =>
      t.clips.map((c) => ({
        ...c,
        timestamp: c.start_time,
        sound_name: c.name,
        track_id: t.track_id,
        is_muted: t.is_muted || !!c.is_muted,
      })),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  const doc = {
    ...p,
    schema_version: 3,
    schema_name: "video_sfx_annotation",
    annotations_role: "session",
    annotations,
    sounds_directory: p.sound_dir,
  };
  if (p.render_dirty)
    for (const field of ["rendered_annotations", "rendered_visuals"]) {
      if (field in doc) {
        (doc as Project)["last_" + field] = (doc as Project)[field];
        delete (doc as Project)[field];
      }
    }
  return doc;
}
export const segments = (p: Project) =>
  p.tracks
    .filter((t) => t.media_type === "video")
    .flatMap((t) => t.clips)
    .sort((a, b) => a.start_time - b.start_time);
export const endTime = (p: Project) =>
  segments(p).reduce((d, c) => Math.max(d, c.start_time + c.duration), 0);
export function segmentAt(clips: Clip[], time: number): Clip | undefined {
  return (
    clips.find(
      (c) => time >= c.start_time && time < c.start_time + c.duration,
    ) ?? clips.at(-1)
  );
}
export function sourceTime(c: Clip, time: number) {
  return c.source_offset + clamp(time - c.start_time, 0, c.duration);
}
export function activeAudio(p: Project, time: number) {
  return p.tracks
    .filter((t) => t.media_type === "audio" && !t.is_muted)
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        !c.is_muted &&
        !c.missing_media &&
        c.review_status !== "rejected" &&
        time >= c.start_time &&
        time < c.start_time + c.duration,
    );
}
export function updateClip(
  p: Project,
  clipId: string,
  fields: Partial<Clip>,
): boolean {
  const track = p.tracks.find((t) => t.clips.some((c) => c.clip_id === clipId));
  const clip = track?.clips.find((c) => c.clip_id === clipId);
  if (!track || !clip || track.is_locked) return false;
  const next = { ...clip, ...fields };
  if (
    ![
      next.start_time,
      next.duration,
      next.source_offset,
      next.volume ?? 1,
    ].every(Number.isFinite) ||
    next.start_time < 0 ||
    next.duration <= 0 ||
    next.source_offset < 0 ||
    (next.volume ?? 1) < 0 ||
    (next.volume ?? 1) > 1 ||
    (next.source_duration != null &&
      next.source_offset + next.duration > next.source_duration + 0.002)
  )
    return false;
  if (clip.review_status === "auto-generated" && !fields.review_status)
    next.review_status = "modified";
  const before = structuredClone(clip);
  Object.assign(clip, next);
  track.clips.sort((a, b) => a.start_time - b.start_time);
  p.correction_history.push({
    action: "edit",
    clip_id: clipId,
    at: new Date().toISOString(),
    before,
    after: structuredClone(clip),
    fields: Object.keys(fields),
  });
  if (fields.review_status && clip.event_id) {
    const event = p.detected_events.find((e) => e.event_id === clip.event_id);
    if (event) event.status = fields.review_status;
  }
  return true;
}
export function splitAudio(p: Project, clipId: string, time: number) {
  const t = p.tracks.find(
    (t) =>
      t.media_type === "audio" &&
      !t.is_locked &&
      t.clips.some((c) => c.clip_id === clipId),
  );
  const c = t?.clips.find((c) => c.clip_id === clipId);
  if (!t || !c || time <= c.start_time || time >= c.start_time + c.duration)
    return false;
  const left = time - c.start_time;
  t.clips.push({
    ...c,
    clip_id: id(),
    start_time: time,
    source_offset: c.source_offset + left,
    duration: c.duration - left,
  });
  c.duration = left;
  t.clips.sort((a, b) => a.start_time - b.start_time);
  return true;
}
export function snap(
  p: Project,
  time: number,
  ignoreId?: string,
  playhead?: number,
) {
  if (!p.snapping_enabled) return Math.max(0, time);
  const edges = p.tracks.flatMap((t) =>
    t.clips
      .filter((c) => c.clip_id !== ignoreId)
      .flatMap((c) => [c.start_time, c.start_time + c.duration]),
  );
  if (playhead !== undefined) edges.push(playhead);
  const closest = [0, ...edges].reduce(
    (a, b) => (Math.abs(a - time) < Math.abs(b - time) ? a : b),
    0,
  );
  return Math.max(
    0,
    Math.abs(closest - time) <= 6 / p.zoom_level
      ? closest
      : Math.round(time * (p.video_info.fps || 30)) / (p.video_info.fps || 30),
  );
}
export const formatTime = (s: number, fps = 30) => {
  const whole = Math.floor(Math.max(0, s)),
    frame = Math.floor((Math.max(0, s) - whole) * fps + 1e-5);
  return [
    Math.floor(whole / 3600),
    Math.floor(whole / 60) % 60,
    whole % 60,
    frame,
  ]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
};
