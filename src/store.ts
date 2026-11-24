import { create } from "zustand";
import { documentForSave, newProject, type Project } from "./model";
type Edit = (draft: Project) => void | boolean;
interface State {
  project: Project;
  path: string | null;
  selected: string | null;
  playhead: number;
  playing: boolean;
  dirty: boolean;
  past: Project[];
  future: Project[];
  generation: number;
  open: (p: Project, path: string | null, dirty?: boolean) => void;
  edit: (fn: Edit) => boolean;
  undo: () => void;
  redo: () => void;
}
export const useEditor = create<State>((set, get) => ({
  project: newProject(),
  path: null,
  selected: null,
  playhead: 0,
  playing: false,
  dirty: false,
  past: [],
  future: [],
  generation: 0,
  open: (project, path, dirty = false) =>
    set((s) => ({
      project,
      path,
      selected: null,
      playhead: 0,
      playing: false,
      dirty,
      past: [],
      future: [],
      generation: s.generation + 1,
    })),
  edit: (fn) => {
    const s = get(),
      p = structuredClone(s.project);
    if (fn(p) === false) return false;
    p.render_dirty = true;
    set({
      project: documentForSave(p),
      past: [...s.past.slice(-49), s.project],
      future: [],
      dirty: true,
    });
    return true;
  },
  undo: () =>
    set((s) =>
      s.past.length
        ? {
            project: s.past.at(-1)!,
            past: s.past.slice(0, -1),
            future: [s.project, ...s.future],
            dirty: true,
            playing: false,
          }
        : {},
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            project: s.future[0],
            past: [...s.past, s.project],
            future: s.future.slice(1),
            dirty: true,
            playing: false,
          }
        : {},
    ),
}));
