import { useEffect, useRef, useCallback } from "react";
import { mediaUrl, soundPath } from "./bridge";
import {
  activeAudio,
  clamp,
  endTime,
  segments,
  segmentAt,
  sourceTime,
  type Clip,
} from "./model";
import { useEditor } from "./store";

export function usePlayer(report: (message: string) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const activeSegment = useRef<Clip | undefined>(undefined);
  const voices = useRef(new Map<string, HTMLAudioElement>());
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);
  const stopVoices = useCallback(() => {
    for (const a of voices.current.values()) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    voices.current.clear();
  }, []);
  const seek = useCallback(
    (time: number, pause = true) => {
      const s = useEditor.getState(),
        duration = endTime(s.project);
      time = clamp(time, 0, duration);
      if (pause) video.current?.pause();
      stopVoices();
      const seg = segmentAt(segments(s.project), time);
      activeSegment.current = seg;
      if (seg && video.current && video.current.readyState >= 1)
        video.current.currentTime = sourceTime(seg, time);
      useEditor.setState({
        playhead: time,
        ...(pause ? { playing: false } : {}),
      });
    },
    [stopVoices],
  );
  const toggle = useCallback(() => {
    const s = useEditor.getState(),
      el = video.current;
    if (!el || !s.project.video_path || endTime(s.project) <= 0) return;
    if (!el.paused) {
      el.pause();
      stopVoices();
      useEditor.setState({ playing: false });
      return;
    }
    seek(s.playhead >= endTime(s.project) - 0.001 ? 0 : s.playhead, false);
    void el.play().catch((e) => reportRef.current(String(e)));
  }, [seek, stopVoices]);
  const project = useEditor((s) => s.project),
    generation = useEditor((s) => s.generation);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let alive = true;
    el.pause();
    el.removeAttribute("src");
    el.load();
    if (project.video_path)
      mediaUrl(project.video_path)
        .then((url) => {
          if (alive) {
            el.src = url;
            el.load();
          }
        })
        .catch((e) => {
          if (alive) reportRef.current(String(e));
        });
    return () => {
      alive = false;
      stopVoices();
    };
  }, [project.video_path, generation, stopVoices]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const s = useEditor.getState();
    el.volume = clamp(project.video_volume ?? 0.8, 0, 1);
    el.muted = project.tracks.some(
      (t) => t.media_type === "video" && t.is_muted,
    );
    seek(s.playhead);
  }, [project, seek]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let frame = 0,
      lastDraw = 0,
      cachedProject = useEditor.getState().project,
      cuts = segments(cachedProject);
    const refreshCuts = () => {
      const p = useEditor.getState().project;
      if (p !== cachedProject) {
        cachedProject = p;
        cuts = segments(p);
      }
    };
    const missing = new Set<string>();
    function advance() {
      if (!el) return;
      refreshCuts();
      const index = cuts.findIndex(
        (c) => c.clip_id === activeSegment.current?.clip_id,
      );
      const next = cuts[index + 1];
      if (next) {
        seek(next.start_time, false);
        void el.play().catch((e) => reportRef.current(String(e)));
      } else if (cachedProject.looping_enabled) {
        seek(0, false);
        void el.play().catch((e) => reportRef.current(String(e)));
      } else seek(endTime(cachedProject));
    }
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (el.paused || el.seeking || el.readyState < 2) {
        if (!el.ended) stopVoices();
        return;
      }
      refreshCuts();
      const seg = activeSegment.current;
      if (!seg) return;
      const time = clamp(
        seg.start_time + el.currentTime - seg.source_offset,
        seg.start_time,
        seg.start_time + seg.duration,
      );
      if (el.currentTime >= seg.source_offset + seg.duration) {
        advance();
        return;
      }
      if (now - lastDraw >= 32) {
        useEditor.setState({ playhead: time, playing: true });
        lastDraw = now;
      }
      const clips = activeAudio(cachedProject, time);
      const ids = new Set(clips.map((c) => c.clip_id));
      for (const [key, a] of voices.current) {
        if (!ids.has(key)) {
          a.pause();
          a.removeAttribute("src");
          a.load();
          voices.current.delete(key);
        }
      }
      for (const c of clips) {
        const target = sourceTime(c, time);
        const urlPath = soundPath(cachedProject, c.file_path);
        if (missing.has(urlPath)) continue;
        let a = voices.current.get(c.clip_id);
        if (!a) {
          a = new Audio();
          a.preload = "auto";
          a.volume = c.volume ?? 1;
          const voice = a;
          voices.current.set(c.clip_id, voice);
          const fail = (reason: unknown) => {
            if (voices.current.get(c.clip_id) !== voice) return;
            missing.add(urlPath);
            voice.pause();
            voices.current.delete(c.clip_id);
            reportRef.current(
              "SFX preview: " + c.name + " — " + String(reason),
            );
          };
          voice.onerror = () => fail("media unavailable");
          mediaUrl(urlPath)
            .then((url) => {
              if (voices.current.get(c.clip_id) !== voice) return;
              voice.onloadedmetadata = () => {
                if (
                  voices.current.get(c.clip_id) !== voice ||
                  el.paused ||
                  el.seeking
                )
                  return;
                const s = activeSegment.current;
                if (!s) return;
                const elapsed = s.start_time + el.currentTime - s.source_offset;
                if (
                  elapsed < c.start_time ||
                  elapsed >= c.start_time + c.duration
                )
                  return;
                voice.currentTime = sourceTime(c, elapsed);
                void voice.play().catch(fail);
              };
              voice.src = url;
            })
            .catch(fail);
        } else if (
          a.readyState >= 2 &&
          !a.seeking &&
          Math.abs(a.currentTime - target) > 0.075
        )
          a.currentTime = target;
      }
    };
    const loaded = () => seek(useEditor.getState().playhead);
    const play = () => useEditor.setState({ playing: true });
    const pause = () => {
      useEditor.setState({ playing: false });
      stopVoices();
    };
    const err = () => {
      if (el.getAttribute("src"))
        reportRef.current(
          "Could not decode this video. Check the path or relink a WebView2-compatible video.",
        );
    };
    el.addEventListener("ended", advance);
    el.addEventListener("loadedmetadata", loaded);
    el.addEventListener("playing", play);
    el.addEventListener("pause", pause);
    el.addEventListener("error", err);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("ended", advance);
      el.removeEventListener("loadedmetadata", loaded);
      el.removeEventListener("playing", play);
      el.removeEventListener("pause", pause);
      el.removeEventListener("error", err);
      stopVoices();
    };
  }, [seek, stopVoices, generation]);
  return { video, seek, toggle };
}
