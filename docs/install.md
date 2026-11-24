# Windows installation

Use Windows 10 or 11 on x64. Download **FoleyMarks_1.0.0_x64-setup.exe** from the maintainer's release page. Use the checksum file to verify the download when needed.

```powershell
Get-FileHash .\FoleyMarks_1.0.0_x64-setup.exe -Algorithm SHA256
```

The NSIS installer uses the current Windows user. It adds a Start Menu shortcut and can download the WebView2 Evergreen runtime if needed. FoleyMarks opens and edits local media offline after the runtime is available. The bundled FFmpeg and Python runtime are available to the application without developer tools.

For a missing source or sound file, check the dataset paths in Settings, rescan after restoring a disconnected drive, and use the relink action to select the moved file. Before uninstalling or moving to another machine, copy the dataset, external sound library, and projects. See [the migration guide](migration.md).

Settings and crash recovery are stored in the Tauri application data folder under the Windows user profile. Release updates reuse the same application identifier and per-user install. Use Windows **Installed apps** to uninstall.
