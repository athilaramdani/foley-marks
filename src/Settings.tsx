import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import manifest from "../package.json";
import {
  Settings2,
  HardDrive,
  Cpu,
  SlidersHorizontal,
  Download,
  Info,
  FolderOpen,
  RotateCw,
} from "lucide-react";
import { Dialog } from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { Field, NumberField } from "./controls";
import { call, type DirKey, type Settings as Prefs } from "./bridge";
import type { Dataset } from "./model";
import type { useUpdates } from "./updates";
const groups = [
  ["General", Settings2],
  ["Dataset & Storage", HardDrive],
  ["Performance", Cpu],
  ["Editor", SlidersHorizontal],
  ["Updates", Download],
  ["About", Info],
] as const;
const dirs: Partial<Record<DirKey, string>> = {
  datasetRoot: "Dataset root",
  videoDir: "Source videos",
  soundDir: "Sound effects",
  annotationDir: "Annotation output",
  exportDir: "Rendered exports",
  cacheDir: "Cache",
  tempDir: "Temporary files",
};
export const keys: Record<string, string> = {
  play: "Space",
  frameBack: ",",
  frameNext: ".",
  split: "s",
  snap: "n",
  add: "q",
  delete: "Delete",
};
export function Settings({
  prefs,
  change,
  rescan,
  dataset,
  close,
  notify,
  update,
  initial,
}: {
  prefs: Prefs;
  change: (s: Prefs) => Promise<void>;
  rescan: () => Promise<void>;
  dataset: Dataset;
  close: () => void;
  notify: (s: string) => void;
  update: ReturnType<typeof useUpdates>;
  initial: string;
}) {
  const [version, setVersion] = useState(manifest.version);
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  const [tab, setTab] = useState(initial),
    [working, setWorking] = useState(false);
  async function handle(fn: () => Promise<unknown>) {
    if (working) return;
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      notify(String(e));
    } finally {
      setWorking(false);
    }
  }
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    void handle(() => change({ ...prefs, [key]: value }));
  const dir = (k: DirKey, label: string) => (
    <Field label={label} key={k}>
      <div className="path-field">
        <input readOnly title={prefs[k]} value={prefs[k] || "Choose folder…"} />
        <Button
          aria-label={"Choose " + label}
          title={"Choose " + label}
          size="icon"
          onClick={() =>
            void handle(async () => {
              const s = await call<Prefs | null>("set_directory", { key: k });
              if (s) {
                await change(s);
                await rescan();
              }
            })
          }
        >
          <FolderOpen size={14} />
        </Button>
      </div>
    </Field>
  );
  const select = (
    label: string,
    key: "theme" | "language" | "startup" | "previewQuality",
    values: string[],
    names: string[] = values,
  ) => (
    <Field label={label}>
      <select
        value={prefs[key]}
        onChange={(e) => set(key, e.target.value as Prefs[typeof key])}
      >
        {values.map((v, i) => (
          <option key={v} value={v}>
            {names[i]}
          </option>
        ))}
      </select>
    </Field>
  );
  const toggle = (
    label: string,
    key: "autoUpdate" | "waveformCache" | "backgroundProcessing" | "snapping",
  ) => (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={prefs[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
    </label>
  );
  return (
    <Dialog
      title={
        prefs.language === "id"
          ? "Pengaturan FoleyMarks"
          : "FoleyMarks settings"
      }
      close={close}
      wide
    >
      <div className="settings-layout">
        <aside className="settings-nav">
          {groups.map(([name, Icon]) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              onClick={() => setTab(name)}
            >
              <Icon size={15} />
              {name}
            </button>
          ))}
        </aside>
        <div className="settings-body">
          <h3>{tab}</h3>
          <fieldset disabled={working}>
            {tab === "General" && (
              <>
                {select(
                  "Workspace language",
                  "language",
                  ["en", "id"],
                  ["English", "Bahasa Indonesia"],
                )}
                {select(
                  "Theme",
                  "theme",
                  ["dark", "light", "system"],
                  ["Dark", "Light", "Use system theme"],
                )}
                {select(
                  "On startup",
                  "startup",
                  ["recover", "blank"],
                  ["Offer saved workspace", "Start empty"],
                )}
                {dir("projectDir", "Default project directory")}
              </>
            )}
            {tab === "Dataset & Storage" && (
              <>
                {Object.entries(dirs).map(([k, label]) =>
                  dir(k as DirKey, label),
                )}
                <div className="stats">
                  <b>{dataset.videos.length} videos</b>
                  <b>{dataset.sounds.length} sounds</b>
                  <b>{dataset.annotations.length} annotations</b>
                  <b>{(dataset.bytes / 1048576).toFixed(1)} MB</b>
                </div>
                {dataset.missing.length > 0 && (
                  <p className="warning">
                    Missing folders: {dataset.missing.join(", ")}
                  </p>
                )}
                <Button onClick={() => void handle(rescan)}>
                  <RotateCw size={14} /> Validate and rescan
                </Button>
              </>
            )}
            {tab === "Performance" && (
              <>
                {select(
                  "Preview sampling",
                  "previewQuality",
                  ["full", "half"],
                  ["Full resolution", "Half resolution"],
                )}
                {toggle("Generate timeline waveforms", "waveformCache")}
                {toggle(
                  "Automatically analyze imported videos",
                  "backgroundProcessing",
                )}
                <p className="hint">
                  Video decoding uses WebView2 and the acceleration available on
                  this device.
                </p>
                <Button
                  onClick={() =>
                    void handle(async () => {
                      const n = await call<number>("clear_waveform_cache");
                      notify("Removed " + n + " cached waveforms.");
                    })
                  }
                >
                  Clear waveform cache
                </Button>
              </>
            )}
            {tab === "Editor" && (
              <>
                {toggle("Snap new timelines", "snapping")}
                <NumberField
                  label="Autosave interval (seconds)"
                  value={prefs.autosaveInterval}
                  min={5}
                  max={600}
                  step={1}
                  change={(v) => set("autosaveInterval", Math.round(v))}
                />
                <h4>Keyboard shortcuts</h4>
                {Object.entries(keys).map(([k, v]) => (
                  <Field
                    key={k}
                    label={
                      (
                        {
                          play: "Play / pause",
                          frameBack: "Previous frame",
                          frameNext: "Next frame",
                          add: "Place sound",
                          split: "Split clip",
                          delete: "Delete clip",
                          snap: "Toggle snapping",
                        } as Record<string, string>
                      )[k]
                    }
                  >
                    <input
                      className="keybind"
                      readOnly
                      aria-label={"Shortcut " + k}
                      value={prefs.shortcuts?.[k] ?? v}
                      onKeyDown={(e) => {
                        if (
                          [
                            "Tab",
                            "Shift",
                            "Control",
                            "Alt",
                            "Meta",
                            "Escape",
                          ].includes(e.key)
                        )
                          return;
                        e.preventDefault();
                        e.stopPropagation();
                        const next = e.key === " " ? "Space" : e.key;
                        if (
                          Object.entries({ ...keys, ...prefs.shortcuts }).some(
                            ([id, val]) =>
                              id !== k &&
                              val.toLowerCase() === next.toLowerCase(),
                          )
                        ) {
                          notify("Shortcut already in use.");
                          return;
                        }
                        set("shortcuts", { ...prefs.shortcuts, [k]: next });
                      }}
                    />
                  </Field>
                ))}
              </>
            )}
            {tab === "Updates" && (
              <>
                {toggle("Check for updates at startup", "autoUpdate")}
                <p>
                  Installed version <b>{version}</b>
                </p>
                {update.info && (
                  <>
                    <h4>FoleyMarks {update.info.version}</h4>
                    <pre className="release-notes">{update.info.body}</pre>
                  </>
                )}
                <p role="status">
                  {
                    {
                      idle: "",
                      checking: "Checking GitHub Releases…",
                      current: "FoleyMarks is up to date.",
                      available: "A signed update is available.",
                      downloading: "Downloading update…",
                      installing: "Installing update…",
                      error: update.error,
                    }[update.status]
                  }
                </p>
                {update.status === "downloading" && (
                  <progress value={update.progress ?? undefined} max={100} />
                )}
                <Button
                  disabled={["checking", "downloading", "installing"].includes(
                    update.status,
                  )}
                  onClick={() => void update.checkNow()}
                >
                  <RotateCw size={14} />
                  Check for updates
                </Button>{" "}
                {update.info && (
                  <Button
                    variant="default"
                    disabled={[
                      "checking",
                      "downloading",
                      "installing",
                    ].includes(update.status)}
                    onClick={() => void update.install()}
                  >
                    Save work & install
                  </Button>
                )}
              </>
            )}
            {tab === "About" && (
              <>
                <div className="about-brand">FoleyMarks</div>
                <p>
                  Desktop video editor and sound effect annotation workspace.
                </p>
                <dl>
                  <dt>Version</dt>
                  <dd>{version}</dd>
                  <dt>Publisher</dt>
                  <dd>Athila Ramdani</dd>
                  <dt>Repository</dt>
                  <dd>github.com/athilaramdani/foley-marks</dd>
                  <dt>Licensing</dt>
                  <dd>See the distribution license and third-party notices.</dd>
                  <dt>Built with</dt>
                  <dd>
                    Tauri 2, Rust, React, TypeScript, FFmpeg, OpenCV and Python.
                  </dd>
                </dl>
              </>
            )}
          </fieldset>
        </div>
      </div>
    </Dialog>
  );
}
