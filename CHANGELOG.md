# Changelog

## v4.4.0 — 2026-06-28

### New: High-sample-rate (hi-res) audio support
Files above 48 kHz (e.g. 96k WAV) now import *and* play. Previously they imported but were silent, because Chromium's `<audio>` decoder rejects WAV above 48 kHz.

- Playback keeps WaveSurfer's streaming `<audio>` element for every file (fast start, no whole-file decode).
- Only `>48 kHz` WAV/AIFF is transcoded to a 48 kHz 32-bit-float WAV, **cached on disk** under `userData/playback-cache/` so the cost is paid once per file (`src/utils/playbackCache.js`).
- `readWavSampleRate()` added to `audioConverter.js` for a cheap header check to decide whether a transcode is needed.
- Waveform peaks are still computed from the original full-resolution file.

### New: Filter button with duration filtering
A new **Filter** button sits next to Tags in the Archive toolbar, opening a panel for narrowing the archive by track length.

- `DurationFilterPanel.jsx` — a dual-handle min/max range slider (matching the brightness filter pattern), styled to match the master volume slider in both light and dark mode.
- Slider max equals the exact longest file's duration; the readout shows the min–max range.
- The duration filter applies to both the visible archive list and random playback. The Filter and Tags panels can be open independently.

## v4.3.0 — 2026-05-10

### New: Color & brightness tagging (Rod Modell-inspired)
Each sound now carries a perceptual **color** (hue tag) and a **brightness** rating from 1–10, so mixes can be assembled by retrieving e.g. *"a green 7"*.

- Per-track colour + brightness assignment via a floating popover (`ColorBrightnessPopover`).
- Vertical colour rail filter (`ColorFilterRail`) — click a swatch to filter the archive by hue.
- Editable colour palette (`PaletteEditor`) — add, rename, recolour, or remove swatches; persisted to the database.
- Default palette seeded on first run: green, red, brown, blue, amber. Green/red/brown follow Modell's own naming; blue and amber added as common neighbours.
- Database schema bumped to **v5** with indexed `color` and `brightness` columns on `audioFiles`.

### New: Imported folders & smart rescan
Folders you import are remembered and can be rescanned to detect changes on disk.

- `importedFolders` store (DB v4) tracks each imported folder, when it was added, and when it was last scanned.
- **Move detection**: when a file goes missing from one folder and an unknown file with the same basename and size appears in another, the two are reunited automatically — your tags, colour, and brightness travel with the file.
- **Missing-file flag** (`isMissing`) is indexed so missing items can be found and surfaced quickly.
- Background rescan runs on import and can be triggered per-folder.

### New: Locate-file dialog
When a file is missing, a native "Locate…" dialog (`dialog:locateFile` IPC handler) lets you point the app at the file's new home, with the original folder pre-selected and audio extensions filtered.

### Improved: Window-bounds persistence
Your window position and size now survive abrupt exits.

- Bounds are debounced-saved to disk on every resize/move (400 ms).
- A synchronous flush runs on `before-quit` (covers ⌘Q on macOS, which doesn't fire `window-all-closed`) and on the window's `close` event.
- Crash or force-quit now leaves a recent snapshot behind instead of forgetting where you left the window.

### New: Windows build
The app now builds for Windows from macOS.

- `npm run build:win` produces `Active Archive Setup 4.3.0.exe` (NSIS installer, x64).
- `npm run build:mac` builds the macOS `.dmg` explicitly.
- Windows icon (`icon.ico`) generated alongside the existing `icon.icns`.
- NSIS configured for per-user install with directory choice.

### Notes
- Unsigned Windows builds will show a SmartScreen warning on first run — this is expected without a code-signing certificate.
- The macOS `hiddenInset` title bar style does not apply on Windows; the Windows build uses the system title bar.
