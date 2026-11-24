import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Project, Dataset, Probe } from "./model";
export const native = isTauri();
export type DirKey =
  | "datasetRoot"
  | "videoDir"
  | "soundDir"
  | "annotationDir"
  | "exportDir"
  | "cacheDir"
  | "tempDir"
  | "projectDir";
export interface Settings extends Record<DirKey, string> {
  theme: "dark" | "light" | "system";
  language: string;
  startup: string;
  previewQuality: string;
  waveformCache: boolean;
  backgroundProcessing: boolean;
  snapping: boolean;
  autosaveInterval: number;
  autoUpdate: boolean;
  shortcuts: Record<string, string>;
}
export const defaultSettings: Settings = {
  theme: "dark",
  language: "en",
  startup: "recover",
  previewQuality: "full",
  waveformCache: true,
  backgroundProcessing: true,
  snapping: true,
  autosaveInterval: 30,
  autoUpdate: true,
  shortcuts: {},
  datasetRoot: "",
  videoDir: "",
  soundDir: "",
  annotationDir: "",
  exportDir: "",
  cacheDir: "",
  tempDir: "",
  projectDir: "",
};
export function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    return Promise.reject(Error("Open FoleyMarks Desktop to use local media."));
  return invoke<T>(cmd, args);
}
export const pick = (
  kind: "video" | "audio" | "project" | "saveProject" | "directory" | "visual",
) => call<string | null>("pick_path", { kind });
export const scan = () => call<Dataset>("scan_dataset");
export const probe = (path: string) => call<Probe>("probe_media", { path });
export const save = (path: string, project: Project) =>
  call<void>("save_project", { path, project });
export const recover = (project: Project) =>
  call<void>("save_recovery", { project });
export const pathJoin = (base: string, path: string) =>
  !path || /^(?:[a-z]:[/\\]|[/\\])/i.test(path) || !base
    ? path
    : base.replace(/[/\\]$/, "") + "/" + path;
const urls = new Map<string, Promise<string>>();
export function mediaUrl(path: string) {
  let url = urls.get(path);
  if (!url) {
    url = call<string>("authorize_media", { path })
      .then(convertFileSrc)
      .catch((e) => {
        urls.delete(path);
        throw e;
      });
    urls.set(path, url);
  }
  return url;
}
export const soundPath = (p: Project, path: string) =>
  pathJoin(p.sound_dir, path);
