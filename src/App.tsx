import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  PanelsTopLeft,
  PanelLeftClose,
  PanelRightClose,
  PanelLeftOpen,
  PanelRightOpen,
  Upload,
  Download,
  Settings2,
  ChevronDown,
  Video,
  FolderOpen,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Maximize,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  Undo2,
  Redo2,
  LoaderCircle,
  X,
  Keyboard,
  MonitorPlay,
  Folder,
} from "lucide-react";
import { Library } from "./Library";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { Settings, keys } from "./Settings";
import { useWorkspace } from "./useWorkspace";
import { usePlayer } from "./player";
import { useUpdates } from "./updates";
import { useEditor } from "./store";
import { basename, clamp, endTime, formatTime } from "./model";
import { call } from "./bridge";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Icon } from "./controls";
import { Detection } from "./Detection";
import { Preview } from "./Preview";
const padNames = {
  en: [
    "Media library",
    "Program monitor",
    "Inspector",
    "Timeline",
    "Import video",
    "Open project",
    "Export",
    "Ready",
    "Workspace",
    "No video loaded",
    "Import a video or open an existing project.",
  ],
  id: [
    "Pustaka media",
    "Pratinjau video",
    "Inspektur",
    "Linimasa",
    "Impor video",
    "Buka proyek",
    "Ekspor",
    "Siap",
    "Ruang kerja",
    "Belum ada video",
    "Impor video atau buka proyek yang sudah ada.",
  ],
};
export default function App() {
  const [message, setMessage] = useState(""),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((s: string) => {
    clearTimeout(timer.current);
    setMessage(s);
    timer.current = setTimeout(() => setMessage(""), 6500);
  }, []);
  const w = useWorkspace(notify),
    player = usePlayer(notify),
    update = useUpdates(w.ready && w.prefs.autoUpdate, w.saveWork);
  const p = useEditor((s) => s.project),
    pos = useEditor((s) => s.playhead),
    playing = useEditor((s) => s.playing),
    dirty = useEditor((s) => s.dirty),
    path = useEditor((s) => s.path),
    undoable = useEditor((s) => s.past.length > 0),
    redoable = useEditor((s) => s.future.length > 0);
  const labels = padNames[w.prefs.language === "id" ? "id" : "en"],
    s = useEditor.getState(),
    duration = endTime(p),
    fps = p.video_info.fps || 30;
  const [settings, setSettings] = useState(""),
    [menu, setMenu] = useState(""),
    [left, setLeft] = useState(true),
    [right, setRight] = useState(true),
    [shortcuts, setShortcuts] = useState(false),
    [detection, setDetection] = useState(false);
  const [sizes, setSizes] = useState(() => {
    try {
      return (
        (JSON.parse(localStorage.getItem("panel-sizes") || "null") as {
          left: number;
          right: number;
          bottom: number;
        }) || { left: 252, right: 244, bottom: 250 }
      );
    } catch {
      return { left: 252, right: 244, bottom: 250 };
    }
  });
  const viewer = useRef<HTMLDivElement>(null);
  const resize = (e: PointerEvent, key: "left" | "right" | "bottom") => {
    const node = e.currentTarget as HTMLElement;
    node.setPointerCapture(e.pointerId);
    const init = key === "bottom" ? e.clientY : e.clientX,
      base = sizes[key];
    const move = (ev: globalThis.PointerEvent) =>
      setSizes((prev) => ({
        ...prev,
        [key]: clamp(
          base +
            ((key === "bottom" ? ev.clientY : ev.clientX) - init) *
              (key === "left" ? 1 : -1),
          key === "bottom" ? 135 : 175,
          key === "bottom"
            ? window.innerHeight * 0.65
            : window.innerWidth * 0.35,
        ),
      }));
    const end = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("lostpointercapture", end);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("lostpointercapture", end);
  };
  useEffect(() => {
    localStorage.setItem("panel-sizes", JSON.stringify(sizes));
  }, [sizes]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu("");
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const save = (as = false) =>
    void w.guard("Saving project", async () => {
      await w.saveProject(as);
    });
  const runKeys = (e: KeyboardEvent) => {
    if (
      settings ||
      shortcuts ||
      detection ||
      w.recovery ||
      w.proposal ||
      w.busy ||
      e.altKey ||
      (e.target instanceof HTMLElement &&
        e.target.closest("input,textarea,select,[contenteditable=true]"))
    )
      return;
    if (e.key === "Escape") {
      setMenu("");
      return;
    }
    const key = e.key.toLowerCase(),
      ctrl = e.ctrlKey || e.metaKey;
    const shortcutsMap = { ...keys, ...w.prefs.shortcuts };
    const is = (k: string) =>
      !ctrl &&
      (e.key === " " ? "space" : key) === shortcutsMap[k].toLowerCase();
    if (ctrl && key === "s") save(e.shiftKey);
    else if (ctrl && key === "o") w.openProject();
    else if (ctrl && key === "i") w.openVideo();
    else if (ctrl && key === "z") {
      if (e.shiftKey) s.redo();
      else s.undo();
    } else if (ctrl && key === "y") s.redo();
    else if (ctrl && key === "c") w.copy();
    else if (ctrl && key === "v") w.paste();
    else if (ctrl && (key === "=" || key === "+" || key === "-"))
      s.edit((d) => {
        d.zoom_level = clamp(d.zoom_level * (key === "-" ? 0.8 : 1.25), 5, 220);
      });
    else if (is("play")) player.toggle();
    else if (is("frameBack")) player.seek(pos - 1 / fps);
    else if (is("frameNext")) player.seek(pos + 1 / fps);
    else if (key === "arrowleft") player.seek(pos - 1);
    else if (key === "arrowright") player.seek(pos + 1);
    else if (is("split")) w.split();
    else if (is("delete")) w.remove();
    else if (is("snap"))
      s.edit((d) => {
        d.snapping_enabled = !d.snapping_enabled;
      });
    else if (is("add") || key === "enter") {
      if (w.asset) void w.addSound(w.asset);
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    window.addEventListener("keydown", runKeys);
    return () => window.removeEventListener("keydown", runKeys);
  });
  const menuItem = (name: string, fn: () => void, key = "", enabled = true) => (
    <button
      disabled={!enabled}
      onClick={() => {
        setMenu("");
        fn();
      }}
    >
      {name}
      {key && <kbd>{key}</kbd>}
    </button>
  );
  const mn = (key: string) => setMenu(menu === key ? "" : key);
  const dropMenu = (key: string, items: React.ReactNode) =>
    menu === key && (
      <div className="menu" onPointerDown={(e) => e.stopPropagation()}>
        {items}
      </div>
    );
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/mark.png" alt="" />
          <b>FoleyMarks</b>
        </div>
        <div className="nav-menus" onPointerDown={(e) => e.stopPropagation()}>
          {["File", "Edit", "View", "Help"].map((name) => (
            <div className="menu-host" key={name}>
              <button
                className={menu === name ? "open" : ""}
                onClick={() => mn(name)}
              >
                {name}
              </button>
              {dropMenu(
                name,
                name === "File" ? (
                  <>
                    {menuItem(labels[4], () => w.openVideo(), "Ctrl I")}
                    {menuItem(labels[5], () => w.openProject(), "Ctrl O")}
                    {menuItem(
                      "Save project",
                      () => save(),
                      "Ctrl S",
                      !!p.video_path,
                    )}
                    {menuItem(
                      "Save project as…",
                      () => save(true),
                      "Ctrl Shift S",
                      !!p.video_path,
                    )}
                    {menuItem(
                      "Save annotation",
                      () => void w.annotation(),
                      "",
                      !!p.video_path,
                    )}
                  </>
                ) : name === "Edit" ? (
                  <>
                    {menuItem("Undo", s.undo, "Ctrl Z", undoable)}
                    {menuItem("Redo", s.redo, "Ctrl Y", redoable)}
                    {menuItem("Copy clip", w.copy, "Ctrl C")}
                    {menuItem("Paste clip", w.paste, "Ctrl V")}
                    {menuItem("Split clip", w.split, "S")}
                    {menuItem("Delete clip", w.remove, "Del")}
                  </>
                ) : name === "View" ? (
                  <>
                    {menuItem("Media library", () => setLeft(!left))}
                    {menuItem("Inspector", () => setRight(!right))}
                    {menuItem("Settings", () => setSettings("General"))}
                  </>
                ) : (
                  <>
                    {menuItem("Keyboard shortcuts", () => setShortcuts(true))}
                    {menuItem("Check for updates", () => {
                      setSettings("Updates");
                      void update.checkNow();
                    })}
                    {menuItem("About FoleyMarks", () => setSettings("About"))}
                  </>
                ),
              )}
            </div>
          ))}
        </div>
        <div className="spacer" />
        <span className="workspace-label">
          <PanelsTopLeft size={14} />
          {labels[8]}
        </span>
        <span className="head-divider" />
        <Icon label="Settings" onClick={() => setSettings("General")}>
          <Settings2 />
        </Icon>
      </header>
      <div className="project-bar">
        <div className="project-name">
          <div className="seq-icon">
            <SlidersHorizontal size={16} />
          </div>
          <div>
            <span>PROJECT</span>
            <strong>
              {path
                ? basename(path)
                : p.video_path
                  ? basename(p.video_path)
                  : "Untitled sequence"}
              {dirty && <i title="Unsaved changes" />}
            </strong>
          </div>
        </div>
        <div className="spacer" />
        <div className="project-tools">
          <Icon label="Undo" disabled={!undoable} onClick={s.undo}>
            <Undo2 />
          </Icon>
          <Icon label="Redo" disabled={!redoable} onClick={s.redo}>
            <Redo2 />
          </Icon>
          <span className="head-divider" />
          <Button onClick={() => w.openVideo()}>
            <Upload size={14} />
            {labels[4]}
          </Button>
          <div className="menu-host" onPointerDown={(e) => e.stopPropagation()}>
            <Button
              variant="default"
              onClick={() => mn("export")}
              disabled={!p.video_path}
            >
              <Download size={14} />
              {labels[6]}
              <ChevronDown size={12} />
            </Button>
            {dropMenu(
              "export",
              <>
                {menuItem("Render dataset", () => void w.exportVideo())}
                {menuItem("Save annotation JSON", () => void w.annotation())}
              </>,
            )}
          </div>
        </div>
      </div>
      <div
        className="workarea"
        style={
          {
            "--left": left ? sizes.left + "px" : "0px",
            "--right": right ? sizes.right + "px" : "0px",
            "--timeline": sizes.bottom + "px",
          } as React.CSSProperties
        }
      >
        <div
          className={
            "top-area " + (!left ? "no-left " : "") + (!right ? "no-right" : "")
          }
        >
          {left && (
            <Library
              dataset={w.dataset}
              add={(e) => void w.addSound(e)}
              select={w.setAsset}
              selected={w.asset?.path || ""}
              importAudio={() => void w.importAudio()}
              openVideo={w.openVideo}
              openProject={w.openProject}
              refresh={() => void w.guard("Scanning dataset", w.rescan)}
              settings={() => setSettings("Dataset & Storage")}
              notify={notify}
              label={labels[0]}
            />
          )}
          <div
            className="resize left-resize"
            onPointerDown={(e) => resize(e, "left")}
          />
          <section className="monitor panel">
            <div className="panel-heading">
              <div className="panel-name">
                <MonitorPlay size={16} />
                {labels[1]}
              </div>
              <div className="spacer" />
              <Icon label="Toggle library" onClick={() => setLeft(!left)}>
                {left ? <PanelLeftClose /> : <PanelLeftOpen />}
              </Icon>
              <Icon label="Toggle inspector" onClick={() => setRight(!right)}>
                {right ? <PanelRightClose /> : <PanelRightOpen />}
              </Icon>
            </div>
            <div className="screen" ref={viewer}>
              <video
                ref={player.video}
                playsInline
                preload="auto"
                className="decoder"
              />
              {p.video_path && duration > 0 ? (
                <Preview
                  video={player.video}
                  project={p}
                  quality={w.prefs.previewQuality}
                />
              ) : (
                <div className="empty-frame">
                  <i />
                  <i />
                  <i />
                  <i />
                  <div className="preview-symbol">
                    <Video size={29} />
                  </div>
                  <h2>
                    {p.video_edit_empty ? "Timeline is empty" : labels[9]}
                  </h2>
                  <p>{labels[10]}</p>
                  <div className="empty-actions">
                    <Button onClick={() => w.openProject()}>
                      <FolderOpen size={14} />
                      {labels[5]}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="transport">
              <time>{formatTime(pos, fps)}</time>
              <div className="transport-buttons">
                <Icon
                  label="Start of sequence"
                  disabled={!duration}
                  onClick={() => player.seek(0)}
                >
                  <SkipBack />
                </Icon>
                <Icon
                  label="Previous frame"
                  disabled={!duration}
                  onClick={() => player.seek(pos - 1 / fps)}
                >
                  <StepBack />
                </Icon>
                <Icon
                  label={playing ? "Pause" : "Play"}
                  disabled={!duration}
                  active
                  onClick={player.toggle}
                >
                  {playing ? <Pause /> : <Play />}
                </Icon>
                <Icon
                  label="Next frame"
                  disabled={!duration}
                  onClick={() => player.seek(pos + 1 / fps)}
                >
                  <StepForward />
                </Icon>
                <Icon
                  label="End of sequence"
                  disabled={!duration}
                  onClick={() => player.seek(duration)}
                >
                  <SkipForward />
                </Icon>
              </div>
              <div className="monitor-extra">
                <Icon
                  label="Toggle source audio"
                  onClick={() =>
                    s.edit((d) => {
                      d.video_volume = d.video_volume ? 0 : 0.8;
                    })
                  }
                >
                  {p.video_volume ? <Volume2 /> : <VolumeX />}
                </Icon>
                <input
                  type="range"
                  aria-label="Source volume"
                  min="0"
                  max="1"
                  step=".01"
                  value={p.video_volume}
                  onChange={(e) =>
                    s.edit((d) => {
                      d.video_volume = +e.target.value;
                    })
                  }
                />
                <Icon
                  label="Fullscreen monitor"
                  onClick={() => {
                    if (document.fullscreenElement)
                      void document.exitFullscreen();
                    else void viewer.current?.requestFullscreen();
                  }}
                >
                  <Maximize />
                </Icon>
              </div>
            </div>
          </section>
          <div
            className="resize right-resize"
            onPointerDown={(e) => resize(e, "right")}
          />
          {right && (
            <Inspector
              relink={w.relink}
              analyze={() => setDetection(true)}
              addVisual={w.addVisual}
              label={labels[2]}
              seek={player.seek}
            />
          )}
        </div>
        <div
          className="resize timeline-resize"
          onPointerDown={(e) => resize(e, "bottom")}
        />
        <Timeline
          seek={player.seek}
          add={(e, t, id) => void w.addSound(e, t, id)}
          split={w.split}
          remove={w.remove}
          reorder={(id, t) => void w.videoEdit("reorder", id, t)}
          wave={w.prefs.waveformCache}
          label={labels[3]}
        />
      </div>
      <footer className="statusbar">
        <span>
          <i />
          {w.busy || labels[7]}
        </span>
        <span>
          <Folder size={12} />
          {w.prefs.datasetRoot
            ? basename(w.prefs.datasetRoot)
            : "Local workspace"}
        </span>
        <div className="spacer" />
        <span>{p.video_path ? fps.toFixed(2) + " fps" : "— fps"}</span>
        <button onClick={() => setShortcuts(true)}>
          <Keyboard size={14} /> Shortcuts
        </button>
      </footer>
      {w.busy && (
        <div className="job" role="status">
          <LoaderCircle className="spin" size={17} />
          {w.busy}…
          {["Rendering dataset", "Analyzing motion"].includes(w.busy) && (
            <Button
              onClick={() =>
                void call("cancel_job").catch((e) => notify(String(e)))
              }
            >
              Cancel
            </Button>
          )}
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <Icon label="Dismiss message" onClick={() => setMessage("")}>
            <X />
          </Icon>
        </div>
      )}
      {settings && (
        <Settings
          initial={settings}
          prefs={w.prefs}
          change={w.change}
          rescan={w.rescan}
          dataset={w.dataset}
          close={() => setSettings("")}
          notify={notify}
          update={update}
        />
      )}
      {detection && (
        <Detection
          project={p}
          selected={s.selected}
          close={() => setDetection(false)}
          run={(o) => void w.analyze(o)}
        />
      )}
      {w.recovery && (
        <Dialog title="Restore your workspace?" close={w.skip}>
          <div className="dialog-body">
            <p>{basename(w.recovery.video_path) || "Recovered project"}</p>
            <p className="hint">
              Restore the locally saved timeline to continue editing.
            </p>
            <div className="dialog-actions">
              <Button onClick={w.skip}>Start empty</Button>
              <Button variant="default" onClick={w.restore}>
                Restore timeline
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {w.proposal && (
        <Dialog title="Save this project?" close={w.cancelProposal}>
          <div className="dialog-body">
            <p>The current timeline has unsaved changes.</p>
            <div className="dialog-actions">
              <Button onClick={w.cancelProposal}>Cancel</Button>
              <Button onClick={() => void w.resolveProposal(false)}>
                Discard
              </Button>
              <Button
                variant="default"
                onClick={() => void w.resolveProposal(true)}
              >
                Save & continue
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {shortcuts && (
        <Dialog title="Keyboard shortcuts" close={() => setShortcuts(false)}>
          <div className="dialog-body">
            <dl className="specs">
              {Object.entries({ ...keys, ...w.prefs.shortcuts }).map(
                ([k, v]) => (
                  <div className="shortcut-pair" key={k}>
                    <dt>{k}</dt>
                    <dd>
                      <kbd>{v}</kbd>
                    </dd>
                  </div>
                ),
              )}
            </dl>
            <Button
              onClick={() => {
                setShortcuts(false);
                setSettings("Editor");
              }}
            >
              Customize shortcuts
            </Button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
