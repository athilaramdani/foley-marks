# FoleyMarks

FoleyMarks is a Windows desktop editor for placing sound effects on video, reviewing automatic suggestions, and exporting a video with timestamped dataset annotations.

## Install

Download the Windows x64 setup executable from [GitHub Releases](https://github.com/athilaramdani/foley-marks/releases). Run it, then open FoleyMarks from the Start menu. Windows may download WebView2 during setup if the runtime is missing. The app bundles its editing runtimes.

Open **Settings → Dataset & Storage** and select your dataset and SFX library folders. Open a source video or a previous metadata file, then audition and drag sounds onto the timeline. Export creates a folder containing the original video, edited MP4 and annotation metadata.

- [Installation and troubleshooting](docs/install.md)
- [Development and test commands](docs/development.md)
- [Architecture and feature parity](docs/architecture.md)
- [Dataset and migration guide](docs/migration.md)
- [Release and updater guide](docs/release.md)
- [Testing report](docs/testing.md)

FoleyMarks source code is licensed under MIT. The installer includes components with their own licenses and notices. [License](LICENSE) · [Media components](media/THIRD-PARTY.md)
