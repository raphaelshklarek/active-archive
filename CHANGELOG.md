# Changelog

## v4.5.0 — 2026-10-28

### New: macOS 27 (Golden Gate) look
- **Unified toolbar.** The title bar is now a single 52px row instead of two (126px), giving the library more room. The native traffic lights sit centred in it; play/stop and the Archive/Shuffler tabs keep their positions.
- The CSS-drawn traffic lights and Graphite-accent detection are gone; the real macOS window buttons handle accent colour, Graphite and inactive state.
- The toolbar dims when the window loses focus, matching how macOS 27 distinguishes active and inactive windows.
- The window background follows Light/Dark mode, so dark mode no longer flashes white on launch or resize.
- Dark-mode fixes: no white square where the scrollbars meet, and empty colour-tag circles are visible again.

### New: Icon Composer app icon with a dark version
- `AppIcon.icon` replaces the `.icns` on macOS 26+, with **light, dark, tinted and clear** appearances generated from the original artwork. The dark appearance swaps the cream frame for near-black.
- Building the Mac app now needs Xcode 26+ with its first-launch components installed (`sudo xcodebuild -runFirstLaunch`).

### Improved: Electron 45
- Upgraded from Electron 28 to **45.1.0** (Chromium 156) and electron-builder to 26.18.0. On macOS 27, Electron 28 could crash when playing WAV files above 48 kHz; that no longer happens.
- **Copy** now puts real file references on the clipboard (`public.file-url` / `NSFilenamesPboardType` on macOS, `CF_HDROP` on Windows), so files paste into Finder and DAWs like Ableton. Paths containing `&` or `<` no longer break it.
- The Add dialog remembers the last folder you added from (Electron 43+ would otherwise always open Downloads).

### Improved: Leaner, faster code
- Shared audio pipeline (`utils/audioFile.js`, `utils/wav.js`) replaces three copies of the WAV parser, two AIFF converters and duplicated loading code in the player, shuffler tracks and import; verified byte-identical on real WAV/AIFF files.
- The archive list no longer re-filters the whole library about 60 times a second during playback (an unused progress value was written to the store on every audio frame).
- Random playback and the archive list share one filter function, so they can't drift apart.
- Removed a legacy path migration that checked every file on disk at each launch, an old combination format, unused IPC handlers, CSS, and a dependency.
- Fixes: resized column/sidebar widths now actually persist; Delete and Cmd+A no longer prompt twice; muted or soloed shuffler tracks stay silent after Reshuffle.

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
