# Dataset migration

FoleyMarks operates on the selected local folders. Its suggested directories are created outside the installation. The original editor may have stored its dataset and SFX library at different locations.

1. Keep a backup of the legacy project folder and external media. Start FoleyMarks and open **Settings → Dataset & Storage**.
2. Pick the existing dataset root and rescan. Validate the detected video and annotation locations. Pick the legacy sound library separately if it lives outside the dataset root.
3. Open a previous export's `metadata.json`. The raw sibling video can be resolved within its export folder. Otherwise relink the video to the original. For a legacy TXT annotation, open it as a project, then relink the source video.
4. Review clip timing, mute, transforms and missing file indicators before exporting. Save a project in the new project directory or export a new dataset folder.
5. Compare the rendered MP4 and JSON against a known legacy session before using the new outputs downstream.

JSON carries source offsets, track state, clip fields, detected events, and metadata. The edited export's `annotations` describe rendered audio, while session state preserves the full timeline. TXT supports timestamp and sound reference. Retain JSON for editable projects.

Standard legacy folders include `raw_videos/`, `annotations/`, `edited_videos/`, and `exports/`. An export folder contains `raw.<extension>`, `edited.mp4`, `metadata.json`, and `metadata.txt`. External SFX files are referenced by the project. Back up any sound alias and library metadata files with the library. Copy the media plus project metadata when moving to a new drive and reselect directory permissions on the new machine.
