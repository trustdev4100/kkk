# QA: installer build on another PC

Checklist for building `release\BodyMeasurementSetup.exe` on a second Windows PC (for example `C:\Code\BodyMeasurement`). This is the pack step only. It does not test scans or license activation.

Run the commands from the repo root in **cmd**, not only inside `desktop`.

## Pass

All of these are true:

- `node -v` prints `v20.20.2` (or another Node 20). `npm -v` prints `10.x`, not 11.
- The log includes `beforeBuild: using bundled desktop/out; skipping npm list and node_modules copy`.
- `npm run dist` finishes without `No JSON content found in output`.
- The log does **not** download `nsis-3.0.4.1.7z` or `7zip-win-x64.tar.gz` when the cache folder below is present.
- `release\BodyMeasurementSetup.exe` exists.

## 1. Node and npm

```bat
node -v
npm -v
where node
where npm
```

| Result | Pass? |
|---|---|
| Node `v20.20.2`, npm `10.8.2` (or another npm 10) | Yes |
| Node 22 or 24, or npm 11 | No. That npm breaks electron-builder’s dependency list. Switch this window to Node 20, then `npm install` from the repo root. |

`where` should show `C:\nvm4w\nodejs\...` only if that install **is** Node 20. A different Node on `PATH` will pack with the wrong npm.

## 2. Dependency list

The pack stops because electron-builder runs `npm list` through PowerShell and gets no JSON back:

```text
searching for node modules  pm=npm
No JSON content found in output
```

That step is unnecessary. electron-vite already writes the app into `desktop\out`, and the installer only packs `out/**/*` and `package.json`.

`scripts\package-windows.js` sets `beforeBuild` to `scripts\electron-builder-hooks.cjs`. That hook returns false, so electron-builder skips `npm list` and does not copy `node_modules` into the installer.

On the build PC (for example `C:\Code\BodyMeasurement`), these two files must be the current copies before `npm run dist`:

```text
scripts\package-windows.js
scripts\electron-builder-hooks.cjs
```

The log should include:

```text
beforeBuild: using bundled desktop/out; skipping npm list and node_modules copy
```

It should not include `searching for node modules`. If the JSON error is still there, this PC is running an older pack script. Copy the two files above, then run step 4 again. After this step passes, NSIS still needs the cache in step 3.

## 3. NSIS and 7-Zip cache

Those tools build `BodyMeasurementSetup.exe`. They are not part of `npm install`. This repo keeps them here:

```text
tools\electron-builder-cache\
  nsis-3.0.4.1\
  nsis-resources-3.4.1\
  7zip@1.0.0\
```

`npm run dist` uses that folder when it exists. If it is missing or empty, the log downloads:

```text
downloading     label=nsis-3.0.4.1.7z
downloading     label=7zip-win-x64.tar.gz
```

Do not press Ctrl+C on that download unless you meant to stop the build. Cancelling leaves no setup exe.

The three archives are already in `programs\electron-builder\`. From the repo root, install them into the cache (this does not install anything for the customer):

```bat
mkdir tools\electron-builder-cache\nsis-3.0.4.1
mkdir tools\electron-builder-cache\nsis-resources-3.4.1
mkdir "tools\electron-builder-cache\7zip@1.0.0"
copy /Y programs\electron-builder\nsis-3.0.4.1.7z tools\electron-builder-cache\nsis-3.0.4.1\
copy /Y programs\electron-builder\nsis-resources-3.4.1.7z tools\electron-builder-cache\nsis-resources-3.4.1\
copy /Y programs\electron-builder\7zip-win-x64.tar.gz "tools\electron-builder-cache\7zip@1.0.0\"
```

Details: [programs/electron-builder/README.md](../programs/electron-builder/README.md). After that copy, step 4 must not download NSIS or 7-Zip.

## 4. Build

From the repo root:

```bat
npm run dist
```

AI extras (only when `third_party\4D-Humans` is already on this PC):

```bat
npm run dist -- --ai-extras
```

| Log line | Meaning |
|---|---|
| `using custom electronDist zip file` and `programs\electron\electron-v34.5.8-win32-x64.zip` | Electron was local. Good. |
| `beforeBuild: using bundled desktop/out` | Step 2 is in effect. `npm list` was skipped. |
| `searching for node modules` then `No JSON content found` | This PC does not have the current pack script. Copy `scripts\package-windows.js` and `scripts\electron-builder-hooks.cjs`, then run again. |
| `downloading nsis-3.0.4.1.7z` or `7zip-win-x64.tar.gz` | Step 3 cache is missing. Let it finish if this PC has a network, or copy the cache and run again. |
| `building target=nsis file=...\release\BodyMeasurementSetup.exe` and the process exits 0 | Pass. |

Confirm the file:

```bat
dir release\BodyMeasurementSetup.exe
```

A warning `default Electron icon is used` means `desktop\build\icon.ico` is missing. The setup can still be produced. See [INSTALLER_UI.md](INSTALLER_UI.md).

## Related

Build details: [DIST.md](DIST.md).
