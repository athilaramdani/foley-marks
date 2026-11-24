import { describe, test, expect, beforeEach } from "vitest";
import {
  newProject,
  newClip,
  newTrack,
  updateClip,
  splitAudio,
  documentForSave,
  activeAudio,
  segmentAt,
  sourceTime,
  segments,
  endTime,
  hydrate,
  snap,
  formatTime,
} from "./model";
import { useEditor } from "./store";

function fixture() {
  const p = newProject("D:/Video 室/footage.mp4", {
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 25,
  });
  const a = newClip("E:/SFX/impact.wav", "audio", 4, 1);
  a.source_duration = 8;
  a.source_offset = 2;
  p.tracks[1].clips.push(a);
  return { p, a };
}
describe("timeline and v3 metadata", () => {
  test("split preserves both source windows and precise split boundary", () => {
    const { p, a } = fixture();
    expect(splitAudio(p, a.clip_id, 2.5)).toBe(true);
    const [left, right] = p.tracks[1].clips;
    expect([left.duration, right.source_offset, right.duration]).toEqual([
      1.5, 3.5, 2.5,
    ]);
    expect(activeAudio(p, 2.5)).toEqual([right]);
    expect(sourceTime(right, 2.75)).toBe(3.75);
  });
  test("trim validates source ends and finite time before commit", () => {
    const { p, a } = fixture();
    expect(updateClip(p, a.clip_id, { source_offset: 7, duration: 2 })).toBe(
      false,
    );
    expect(updateClip(p, a.clip_id, { start_time: NaN })).toBe(false);
    expect(a.source_offset).toBe(2);
    expect(
      updateClip(p, a.clip_id, {
        source_offset: 3,
        duration: 2,
        start_time: 4,
      }),
    ).toBe(true);
    expect(sourceTime(a, 4.75)).toBe(3.75);
  });
  test("repositioning protects automatic proposals from regeneration", () => {
    const { p, a } = fixture();
    a.review_status = "auto-generated";
    updateClip(p, a.clip_id, { start_time: 2 });
    expect(a.review_status).toBe("modified");
    expect(p.correction_history).toHaveLength(1);
  });
  test("rejected event status survives review and reanalysis", () => {
    const { p, a } = fixture();
    a.event_id = "impact1";
    p.detected_events = [{ event_id: "impact1" }];
    updateClip(p, a.clip_id, { review_status: "rejected" });
    expect(p.detected_events[0].status).toBe("rejected");
    expect(activeAudio(p, 2)).toEqual([]);
  });
  test("muted tracks and hidden tracks have independent audio behavior", () => {
    const { p, a } = fixture();
    p.tracks[1].is_visible = false;
    const b = newTrack("audio", "Overlaps");
    b.clips = [{ ...a, clip_id: "two" }];
    p.tracks.push(b);
    expect(activeAudio(p, 2)).toHaveLength(2);
    b.is_muted = true;
    expect(activeAudio(p, 2)).toEqual([a]);
  });
  test("legacy custom metadata, source paths and filtered render history survive save", () => {
    const { p, a } = fixture();
    p.tool_extension = { abc: 1 };
    a.unknown_tag = "fox";
    p.rendered_annotations = [{ old: true }];
    p.render_dirty = true;
    const d = documentForSave(hydrate(p));
    expect(d.annotations).toEqual([
      expect.objectContaining({
        unknown_tag: "fox",
        source_offset: 2,
        sound_name: "impact.wav",
        timestamp: 1,
      }),
    ]);
    expect(d.tool_extension).toEqual({ abc: 1 });
    expect(d.last_rendered_annotations).toEqual([{ old: true }]);
    expect(d.rendered_annotations).toBeUndefined();
    expect(p.rendered_annotations).toBeDefined();
  });
  test("locked track rejects edits and splits", () => {
    const { p, a } = fixture();
    p.tracks[1].is_locked = true;
    expect(updateClip(p, a.clip_id, { volume: 0 })).toBe(false);
    expect(splitAudio(p, a.clip_id, 2)).toBe(false);
  });
  test("split video source order maps project clock after reorder and seek", () => {
    const { p } = fixture(),
      v = p.tracks[0].clips[0];
    p.tracks[0].clips = [
      { ...v, start_time: 0, source_offset: 4, duration: 6 },
      { ...v, clip_id: "two", start_time: 6, source_offset: 0, duration: 4 },
    ];
    const seq = segments(p);
    expect(sourceTime(segmentAt(seq, 6)!, 6.125)).toBe(0.125);
    expect(endTime(p)).toBe(10);
  });
  test("empty edit never resurrects footage", () => {
    const { p } = fixture();
    p.tracks[0].clips = [];
    p.video_edit_empty = true;
    expect(endTime(hydrate(p))).toBe(0);
  });
  test("snap uses zoom-relative edge distance and frame fallback", () => {
    const { p } = fixture();
    expect(snap(p, 1.01)).toBe(1);
    expect(snap(p, 1.131)).toBe(1.12);
    p.snapping_enabled = false;
    expect(snap(p, 1.131)).toBe(1.131);
  });
  test("frame timecode with noninteger fps", () =>
    expect(formatTime(1.52, 25)).toBe("00:00:01:13"));
});
describe("transaction history", () => {
  beforeEach(() => useEditor.getState().open(fixture().p, null));
  test("undo redo and history branching", () => {
    const s = useEditor.getState();
    s.edit((p) => {
      p.video_volume = 0.5;
    });
    s.undo();
    expect(useEditor.getState().project.video_volume).toBe(0.8);
    s.redo();
    expect(useEditor.getState().project.video_volume).toBe(0.5);
    s.undo();
    s.edit((p) => {
      p.video_volume = 0.3;
    });
    expect(useEditor.getState().future).toHaveLength(0);
  });
  test("invalid edit leaves project reference and history unchanged", () => {
    const s = useEditor.getState();
    expect(s.edit(() => false)).toBe(false);
    expect(useEditor.getState().project).toBe(s.project);
    expect(useEditor.getState().past).toHaveLength(0);
  });
});
