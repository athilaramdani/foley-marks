import type { DetectionOptions } from "./Detection";
import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  call,
  pick,
  native,
  defaultSettings,
  scan,
  probe,
  save,
  recover,
  type Settings,
} from "./bridge";
import {
  newProject,
  newClip,
  newTrack,
  hydrate,
  documentForSave,
  emptyDataset,
  basename,
  endTime,
  splitAudio,
  type Clip,
  type Project,
  type Entry,
} from "./model";
import { useEditor } from "./store";
let recoveryQueue = Promise.resolve();
function checkpoint(p: Project) {
  const next = recoveryQueue.then(() => recover(documentForSave(p)));
  recoveryQueue = next.catch(() => {});
  return next;
}
export function useWorkspace(notify: (s: string) => void) {
  const [prefs, setPrefs] = useState<Settings>(defaultSettings),
    [ready, setReady] = useState(false),
    [dataset, setDataset] = useState(emptyDataset),
    [busy, setBusy] = useState(""),
    [recovery, setRecovery] = useState<Project | null>(null),
    [asset, setAsset] = useState<Entry | null>(null);
  const lock = useRef(false),
    clipboard = useRef<Clip | null>(null),
    [proposal, setProposal] = useState<(() => Promise<void>) | null>(null);
  const guard = async (label: string, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(String(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const rescan = useCallback(async () => {
    const result = await scan();
    setDataset(result);
  }, []);
  useEffect(() => {
    if (!native) return;
    let alive = true;
    async function load() {
      const settings = {
        ...defaultSettings,
        ...(await call<Settings>("get_settings")),
      };
      if (!alive) return;
      setPrefs(settings);
      setReady(true);
      if (settings.startup === "recover") {
        const r = await call<Project | null>("load_recovery");
        if (alive && r) setRecovery(r);
      }
      if (alive) await rescan();
    }
    load().catch((e) => {
      if (alive) notify(String(e));
    });
    return () => {
      alive = false;
    };
  }, [notify, rescan]);
  const change = async (s: Settings) => {
    await call("save_settings", { settings: s });
    setPrefs(s);
  };
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.lang = prefs.language;
  }, [prefs.theme, prefs.language]);
  const saveWork = useCallback(async () => {
    let s = useEditor.getState();
    if (!s.project.video_path && !s.dirty) return;
    let saved: Project;
    do {
      saved = s.project;
      await checkpoint(saved);
      s = useEditor.getState();
    } while (saved !== s.project);
  }, []);
  useEffect(() => {
    if (!ready) return;
    let last: Project | undefined;
    const timer = setInterval(
      () => {
        const { dirty, project } = useEditor.getState();
        if (dirty && project !== last) {
          last = project;
          checkpoint(project).catch((e) => {
            last = undefined;
            notify(String(e));
          });
        }
      },
      Math.max(5, prefs.autosaveInterval) * 1000,
    );
    return () => clearInterval(timer);
  }, [ready, prefs.autosaveInterval, notify]);
  useEffect(() => {
    if (!native) return;
    const win = getCurrentWindow();
    const off = win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (lock.current) {
        notify("Finish or cancel the active operation before closing.");
        return;
      }
      try {
        await saveWork();
        await win.destroy();
      } catch (e) {
        notify("Could not save recovery: " + String(e));
      }
    });
    return () => {
      void off.then((f) => f());
    };
  }, [saveWork, notify]);
  async function saveProject(as = false) {
    const s = useEditor.getState(),
      path = (!as && s.path) || (await pick("saveProject"));
    if (!path) return false;
    const doc = documentForSave(s.project);
    await save(path, doc);
    if (useEditor.getState().project === s.project)
      useEditor.setState({ path, dirty: false });
    await checkpoint(s.project);
    notify("Project saved · " + basename(path));
    return true;
  }
  const replace = (fn: () => Promise<void>) => {
    if (useEditor.getState().dirty) setProposal(() => fn);
    else void fn();
  };
  async function analysis(options?: DetectionOptions) {
    const s = useEditor.getState(),
      p = s.project;
    if (!endTime(p)) throw Error("Import a video before running detection.");
    const result = await call<Project>("run_analysis", {
      project: documentForSave(p),
      ...options,
    });
    if (p !== useEditor.getState().project)
      throw Error(
        "Timeline changed during analysis. Run analysis again to use the current edits.",
      );
    s.edit((d) => Object.assign(d, hydrate(result)) && true);
    notify(
      "Analysis finished · " +
        (result.detected_events?.length ?? 0) +
        " events",
    );
  }
  function openVideo(path?: string) {
    replace(() =>
      guard("Importing video", async () => {
        const file = path || (await pick("video"));
        if (!file) return;
        const info = await probe(file);
        if (!info.duration || !info.width)
          throw Error("The selected file has no readable video stream.");
        const p = newProject(file, info);
        p.sound_dir = prefs.soundDir;
        p.snapping_enabled = prefs.snapping;
        useEditor.getState().open(p, null, true);
        await checkpoint(p);
        if (prefs.backgroundProcessing && dataset.sounds.length) {
          setBusy("Analyzing motion");
          await analysis();
        }
      }),
    );
  }
  function openProject(path?: string) {
    replace(() =>
      guard("Opening project", async () => {
        const file = path || (await pick("project"));
        if (!file) return;
        const p = hydrate(await call<Project>("load_project", { path: file }));
        if (!p.sound_dir) p.sound_dir = prefs.soundDir;
        useEditor
          .getState()
          .open(p, path || /\.txt$/i.test(file) ? null : file);
        await checkpoint(p);
        const count = p.tracks
          .flatMap((t) => t.clips)
          .filter((c) => c.missing_media).length;
        notify(
          count
            ? count +
                " missing media files. Select a clip and choose Relink source."
            : "Opened " + basename(file),
        );
      }),
    );
  }
  async function addSound(
    e: Entry,
    time = useEditor.getState().playhead,
    trackId?: string,
  ) {
    await guard("Placing sound", async () => {
      const before = useEditor.getState(),
        p = before.project;
      if (!endTime(p)) throw Error("Import a video before placing a sound.");
      const meta = await probe(e.path);
      if (before.generation !== useEditor.getState().generation) return;
      if (!Number.isFinite(meta.duration) || meta.duration <= 0)
        throw Error("The selected sound has an invalid duration.");
      const c = newClip(e.path, "audio", meta.duration, time);
      c.category = e.category;
      c.review_status = "manual";
      if (time >= endTime(p))
        throw Error("Place the playhead before the end of the video.");
      const added = before.edit((d) => {
        const dest =
          d.tracks.find((t) => t.track_id === trackId) ??
          d.tracks.find((t) => t.media_type === "audio" && !t.is_locked);
        if (!dest || dest.media_type !== "audio" || dest.is_locked)
          return false;
        dest.clips.push(c);
        dest.clips.sort((a, b) => a.start_time - b.start_time);
      });
      if (added) useEditor.setState({ selected: c.clip_id });
      else notify("Create or unlock an audio track first.");
    });
  }
  async function importAudio() {
    try {
      const path = await pick("audio");
      if (!path) return;
      const e = { path, name: basename(path), size: 0, category: "Imported" };
      setDataset((d) => ({
        ...d,
        sounds: [...d.sounds.filter((s) => s.path !== path), e],
      }));
      setAsset(e);
    } catch (e) {
      notify(String(e));
    }
  }
  async function videoEdit(action: string, clipId: string, time: number) {
    await guard("Editing video", async () => {
      const s = useEditor.getState(),
        result = await call<Project>("edit_video", {
          project: documentForSave(s.project),
          action,
          clipId,
          time,
        });
      if (s.project !== useEditor.getState().project)
        throw Error("Timeline changed. Repeat the edit.");
      s.edit((d) => {
        Object.assign(d, hydrate(result));
      });
      useEditor.setState({
        playhead: Math.min(s.playhead, endTime(result)),
        playing: false,
      });
    });
  }
  const selected = () => {
    const s = useEditor.getState();
    const t = s.project.tracks.find((t) =>
      t.clips.some((c) => c.clip_id === s.selected),
    );
    return { s, t, c: t?.clips.find((c) => c.clip_id === s.selected) };
  };
  function split() {
    const { s, t, c } = selected();
    if (!c || t?.is_locked) return;
    if (c.media_type === "video")
      void videoEdit("split", c.clip_id, s.playhead);
    else if (!s.edit((p) => splitAudio(p, c.clip_id, s.playhead)))
      notify("Move the playhead inside the selected sound.");
  }
  function remove() {
    const { s, t, c } = selected();
    if (!t || !c || t.is_locked) return;
    if (c.media_type === "video") {
      void videoEdit("delete", c.clip_id, s.playhead);
      return;
    }
    s.edit((p) => {
      p.tracks.find((r) => r.track_id === t.track_id)!.clips = t.clips.filter(
        (v) => v.clip_id !== c.clip_id,
      );
      p.correction_history.push({
        action: "delete",
        clip_id: c.clip_id,
        before: structuredClone(c),
        after: null,
        affects_render: true,
        at: new Date().toISOString(),
      });
    });
    useEditor.setState({ selected: null });
  }
  function copy() {
    const { c } = selected();
    if (c && c.media_type !== "video") clipboard.current = structuredClone(c);
  }
  function paste() {
    const c = clipboard.current,
      s = useEditor.getState();
    if (!c || !s.project.video_path) return;
    const clone = {
      ...structuredClone(c),
      clip_id: crypto.randomUUID(),
      start_time: s.playhead,
    };
    const done = s.edit((d) => {
      const t = d.tracks.find(
        (t) => !t.is_locked && t.media_type === c.media_type,
      );
      if (!t) return false;
      t.clips.push(clone);
    });
    if (done) useEditor.setState({ selected: clone.clip_id });
  }
  function relink(c?: Clip) {
    void guard("Relinking source", async () => {
      const kind = c?.media_type || "video",
        path = await pick(kind);
      if (!path) return;
      const info = kind !== "visual" ? await probe(path) : null;
      useEditor.getState().edit((d) => {
        if (kind === "video") {
          if (
            d.tracks.some(
              (t) =>
                t.media_type === "video" &&
                t.clips.some(
                  (i) =>
                    i.source_offset + i.duration > (info?.duration ?? 0) + 0.05,
                ),
            )
          )
            throw Error(
              "Replacement video is shorter than the timeline source ranges.",
            );
          d.video_path = path;
          d.video_info = info!;
          for (const t of d.tracks.filter((t) => t.media_type === "video"))
            for (const i of t.clips) {
              i.file_path = path;
              i.name = basename(path);
            }
        } else if (c) {
          const track = d.tracks.find((t) =>
            t.clips.some((i) => i.clip_id === c.clip_id),
          );
          if (track?.is_locked) return false;
          const item = track?.clips.find((i) => i.clip_id === c.clip_id);
          if (!item) return false;
          if (
            info &&
            !item.duration_unknown &&
            item.source_offset + item.duration > info.duration + 0.05
          )
            throw Error("Replacement sound is shorter than this clip.");
          if (item.duration_unknown && info) item.duration = info.duration;
          Object.assign(item, {
            file_path: path,
            name: basename(path),
            source_duration: info?.duration,
            missing_media: false,
            duration_unknown: false,
          });
          delete item.asset_hash;
        }
      });
    });
  }
  async function addVisual(sticker = false) {
    let assetPath = "";
    if (sticker) {
      try {
        assetPath = (await pick("visual")) || "";
      } catch (e) {
        notify(String(e));
        return;
      }
      if (!assetPath) return;
    }
    useEditor.getState().edit((d) => {
      let t = d.tracks.find((t) => t.media_type === "visual" && !t.is_locked);
      if (!t) {
        t = newTrack("visual", "Visual FX");
        d.tracks.push(t);
      }
      const c = newClip(assetPath, "visual", 1, useEditor.getState().playhead);
      Object.assign(c, {
        name: sticker ? basename(assetPath) : "Exclamation",
        effect: sticker ? "sticker" : "exclamation",
        x: 0.5,
        y: 0.5,
        scale: 0.2,
      });
      t.clips.push(c);
      useEditor.setState({ selected: c.clip_id });
    });
  }
  return {
    prefs,
    ready,
    change,
    dataset,
    rescan,
    asset,
    setAsset,
    busy,
    guard,
    openVideo,
    openProject,
    saveProject,
    saveWork,
    addSound,
    importAudio,
    videoEdit,
    split,
    remove,
    copy,
    paste,
    relink,
    addVisual,
    analyze: (options?: DetectionOptions) =>
      guard("Analyzing motion", () => analysis(options)),
    exportVideo: () =>
      guard("Rendering dataset", async () => {
        const folder = await call<string>("export_project", {
          project: documentForSave(useEditor.getState().project),
        });
        notify("Exported dataset · " + folder);
      }),
    annotation: () =>
      guard("Saving annotation", async () => {
        const file = await call<string>("save_annotation", {
          project: documentForSave(useEditor.getState().project),
        });
        notify("Saved annotation · " + file);
      }),
    recovery,
    restore: () => {
      if (recovery) useEditor.getState().open(hydrate(recovery), null, true);
      setRecovery(null);
    },
    skip: () => setRecovery(null),
    proposal,
    resolveProposal: async (saveFirst: boolean) => {
      if (!proposal) return;
      try {
        if (saveFirst && !(await saveProject(true))) return;
        setProposal(null);
        await proposal();
      } catch (e) {
        notify(String(e));
      }
    },
    cancelProposal: () => setProposal(null),
  };
}
