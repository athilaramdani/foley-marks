# Architecture

FoleyMarks is an offline editor with three layers.

- **React, TypeScript, Vite and Zustand** render the workspace and maintain the editable project, selection and undo history. Tailwind and shadcn/ui primitives provide the controls. Lucide provides the icons. The video element supplies the playback clock, and audio clips map that clock to source offsets.
- **Tauri and Rust** own Windows dialogs, allowed file paths, dataset discovery, settings, persistence, recovery, waveform caching and media jobs. User directory selections and explicit file picks grant access. Imported metadata is data and cannot grant access to arbitrary files. Tauri capabilities expose the updater and process-restart methods to the main window.
- **FFmpeg, FFprobe and a packaged Python worker** handle probing, waveforms, preview conversions, optical-flow analysis and rendering. The renderer and analysis carry forward the tested legacy models, metadata validation, timing and SFX matching. The worker handles bounded operations with JSON messages. The app can cancel media jobs.

Dataset metadata is the portable persistence format. Settings, picker grants and recovery are per-user JSON kept outside the install directory. Replacing files atomically keeps the last complete state across interrupted writes. A database would duplicate the project files and is unnecessary for the current settings and local index.

## Legacy audit

The old Qt program composes a QWidget workspace from library, preview, timeline and annotation panels. Controllers wire commands and signals to model snapshots and service operations. QMediaPlayer drives source playback and individual SFX players. Qt callbacks map source time to edited time after seeks, playback completion and clip boundaries. OpenCV estimates motion candidates. MoviePy renders the final timeline, moves annotations with edits and publishes an export folder after successful rendering.

The legacy tests exercise drop/move history, overlapping playback, end-of-stream restart, timeline coordinate changes after split/reorder/delete, transforms, missing media, automatic analysis, old metadata and render parity. Copying the Qt playback layer into a WebView would couple the application to two playback clocks. The new preview uses WebView2 as the source clock, with separate FFmpeg rendering and a Python worker for reusable legacy logic.

## Feature parity checklist

| Workflow | Migration target | Verification |
| --- | --- | --- |
| Launch, preferences and recovery | Rust persistent settings and project recovery | Native and installer smoke |
| Import video and legacy projects | Native picker, schema v1–v3 JSON, timestamp TXT and relative export media | Native and worker tests |
| Library scan, audition and missing files | Configured dataset roots, filtered SFX list and native file relink | Native and desktop checks |
| Seek, frame step, zoom and multi-track playback | Preview clock maps each edited segment and SFX | Frontend tests, desktop QA and listening |
| Place, split, trim, move, mute, lock and undo | Undoable edits and source offsets | Frontend and worker tests |
| Video split, reorder and delete | Existing edit rules move linked audio and visual intervals transactionally | Worker tests |
| Video image transforms and visual overlays | Reuse legacy transform and compositing in export | Worker parity checks |
| Automatic annotation | Optical flow, event matching and review workflow | Worker synthetic tests |
| Export source, video and metadata | FFmpeg-backed encoding and legacy dataset schema | Worker and native smoke |
| Legacy revision workflows and extended metadata fields | Preserve metadata on reopen and save | See testing report for UI gaps |
| Install, update and uninstall | NSIS, signed Tauri manifests and per-user installation | Release checks and staging verification |

See [testing and known limitations](testing.md) for results and coverage boundaries.
