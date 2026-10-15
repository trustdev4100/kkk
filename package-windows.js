"use strict";

/**
 * Phase 10 — build BodyMeasurementSetup.exe
 *
 * 1. PyInstaller core backend (cameras, calibration, vision ONNX)
 * 2. electron-vite production build
 * 3. electron-builder NSIS
 *
 * Never downloads model weights. Copies local models/ and known-body demo assets if present.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const desktopDir = path.join(repoRoot, "desktop");
const electronBuilderCache = path.join(repoRoot, "tools", "electron-builder-cache");
const electronZip = path.join(
  repoRoot,
  "programs",
  "electron",
  "electron-v34.5.8-win32-x64.zip"
);
const checkOnly = process.argv.includes("--check");
const aiExtras = process.argv.includes("--ai-extras");
const isWin = process.platform === "win32";

const venvPython = isWin
  ? path.join(repoRoot, "backend", ".venv", "Scripts", "python.exe")
  : path.join(repoRoot, "backend", ".venv", "bin", "python");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function packagingEnv() {
  const env = { ...process.env };
  // Prefer the vendored NSIS/7zip cache so offline PCs do not download.
  if (fs.existsSync(electronBuilderCache)) {
    env.ELECTRON_BUILDER_CACHE = electronBuilderCache;
  }
  return env;
}

function run(command, args, cwd) {
  // On Windows, spawnSync('npm.cmd', …) without a shell returns EINVAL
  // (status null → packaged as exit 1) even though `npm run …` works in a terminal.
  const useShell = isWin && (command === "npm" || /\.cmd$/i.test(command));
  const resolved = command === "npm" && isWin ? "npm.cmd" : command;
  const result = spawnSync(resolved, args, {
    cwd: cwd || repoRoot,
    stdio: "inherit",
    windowsHide: true,
    env: packagingEnv(),
    shell: useShell
  });
  if (result.error) {
    fail(
      `${command} ${args.join(" ")} failed: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit ${result.status ?? 1}`);
  }
}

function extraResource(fromRel, to) {
  const from = path.join(repoRoot, fromRel);
  if (!fs.existsSync(from)) {
    return null;
  }
  return { from, to };
}

// Kept beside BodyMeasurementSetup.exe. NSIS mmap fails if these are inside the archive.
const SIDE_BY_SIDE_WEIGHTS = [
  ["models", "reconstruction", "epoch=35-step=1000000.ckpt"],
  ["models", "smplx", "SMPLX_NEUTRAL.pkl"],
  ["models", "smplx", "SMPLX_FEMALE.pkl"],
  ["models", "smplx", "SMPLX_MALE.pkl"]
];

function modelsResource() {
  const from = path.join(repoRoot, "models");
  if (!fs.existsSync(from)) {
    return null;
  }
  return {
    from,
    to: "models",
    filter: [
      "**/*",
      "!**/epoch=35-step=1000000.ckpt",
      "!**/SMPLX_NEUTRAL.pkl",
      "!**/SMPLX_FEMALE.pkl",
      "!**/SMPLX_MALE.pkl"
    ]
  };
}

function copySideBySideWeights() {
  const releaseDir = path.join(repoRoot, "release");
  for (const parts of SIDE_BY_SIDE_WEIGHTS) {
    const src = path.join(repoRoot, ...parts);
    if (!fs.existsSync(src)) {
      console.log(`  side-by-side weight missing, skipped: ${parts.join("\\")}`);
      continue;
    }
    const dest = path.join(releaseDir, ...parts);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    console.log(`Copying ${parts[parts.length - 1]} next to the setup exe ...`);
    fs.copyFileSync(src, dest);
    console.log(`  ${dest}`);
  }
}

function plannedResources() {
  const items = [
    extraResource(path.join("dist", "backend"), "backend"),
    extraResource("config", "config"),
    modelsResource(),
    extraResource(path.join("tests", "assets"), "tests/assets")
  ];
  if (aiExtras) {
    items.push(extraResource(path.join("third_party", "4D-Humans"), "third_party/4D-Humans"));
  }
  return items.filter(Boolean);
}

function resolveElectronVersion() {
  const candidates = [
    path.join(repoRoot, "node_modules", "electron", "package.json"),
    path.join(desktopDir, "node_modules", "electron", "package.json")
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const version = JSON.parse(fs.readFileSync(candidate, "utf8")).version;
      if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version)) {
        return version;
      }
    } catch {
      // try next
    }
  }
  return "34.5.8";
}

function writeBuilderConfig({ requireBackend = true } = {}) {
  const extraResources = plannedResources();
  if (requireBackend && !extraResources.some((item) => item.to === "backend")) {
    fail(
      "dist/backend is missing. Package the backend before electron-builder."
    );
  }
  const config = {
    appId: "com.offline.bodymeasurement",
    productName: "Offline Body Measurement",
    copyright: "Offline Body Measurement System",
    artifactName: "BodyMeasurementSetup.${ext}",
    electronVersion: resolveElectronVersion(),
    // Local zip so electron-builder does not download electron-v34.5.8-win32-x64.zip.
    ...(fs.existsSync(electronZip) ? { electronDist: electronZip } : {}),
    directories: {
      output: path.join(repoRoot, "release"),
      buildResources: path.join(desktopDir, "build")
    },
    files: ["out/**/*", "package.json"],
    // Skip electron-builder's `npm list` collector. See scripts/electron-builder-hooks.cjs.
    beforeBuild: path.join(repoRoot, "scripts", "electron-builder-hooks.cjs"),
    asar: true,
    extraResources,
    extraMetadata: {
      main: "./out/main/main.js"
    },
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      // Application icon for Offline Body Measurement.exe (taskbar, shortcuts).
      // Place a 256x256 .ico at desktop/build/icon.ico. See docs/INSTALLER_UI.md.
      icon: path.join(desktopDir, "build", "icon.ico"),
      // Skip code signing, but still write the icon into the exe.
      signExecutable: false
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "Offline Body Measurement",
      artifactName: "BodyMeasurementSetup.exe",
      // Single language; override strings in desktop/build/installer.nsh (docs/INSTALLER_UI.md).
      language: "1033",
      installerLanguages: ["en_US"],
      multiLanguageInstaller: false,
      // Allow LangString overrides in installer.nsh (NSIS 6030 would otherwise fail the build).
      warningsAsErrors: false,
      include: "build/installer.nsh"
    }
  };
  const outDir = path.join(repoRoot, "dist");
  fs.mkdirSync(outDir, { recursive: true });
  const configPath = path.join(outDir, "electron-builder.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

function printCheckPlan() {
  console.log("Phase 10 packaging check");
  console.log(`  repo: ${repoRoot}`);
  console.log(`  python: ${venvPython}`);
  console.log(`  backend entry: ${path.join(repoRoot, "backend", "run.py")}`);
  console.log(`  ai extras: ${aiExtras ? "yes" : "no (core pack)"}`);
  console.log("  extraResources (when present):");
  for (const item of plannedResources()) {
    console.log(`    ${item.from} -> ${item.to}`);
  }
  if (!plannedResources().some((item) => item.to === "backend")) {
    console.log("    (backend exe will be created by PyInstaller during npm run dist)");
  }
  if (fs.existsSync(electronZip)) {
    console.log(`  electron zip: ${electronZip}`);
  } else {
    console.log(
      "  electron zip: missing programs/electron/electron-v34.5.8-win32-x64.zip (electron-builder may download it)"
    );
  }
  if (fs.existsSync(electronBuilderCache)) {
    console.log(`  ELECTRON_BUILDER_CACHE: ${electronBuilderCache}`);
  } else {
    console.log(
      "  ELECTRON_BUILDER_CACHE: missing tools/electron-builder-cache (NSIS may download)"
    );
  }
  const builderBin = path.join(
    desktopDir,
    "node_modules",
    "electron-builder",
    "cli.js"
  );
  const hoisted = path.join(
    repoRoot,
    "node_modules",
    "electron-builder",
    "cli.js"
  );
  if (!fs.existsSync(builderBin) && !fs.existsSync(hoisted)) {
    console.log(
      "  note: electron-builder is not installed yet; npm install adds it."
    );
  } else {
    console.log("  electron-builder: present");
  }
}

if (!fs.existsSync(venvPython)) {
  fail("backend/.venv not found. Run npm install from the repository root.");
}

const backendArgs = [path.join(repoRoot, "scripts", "package_backend.py")];
if (checkOnly) {
  backendArgs.push("--check");
}
if (aiExtras) {
  backendArgs.push("--ai-extras");
}

run(venvPython, backendArgs);
printCheckPlan();

if (checkOnly) {
  writeBuilderConfig({ requireBackend: false });
  console.log("dist:check OK — core imports and installer config are ready.");
  process.exit(0);
}

run("npm", ["run", "build", "--workspace", "desktop"]);
const configPath = writeBuilderConfig();
const builderCli = fs.existsSync(
  path.join(desktopDir, "node_modules", "electron-builder", "cli.js")
)
  ? path.join(desktopDir, "node_modules", "electron-builder", "cli.js")
  : path.join(repoRoot, "node_modules", "electron-builder", "cli.js");
if (!fs.existsSync(builderCli)) {
  fail("electron-builder is not installed. Run npm install from the repository root.");
}
run(process.execPath, [builderCli, "--win", "nsis", "--config", configPath], desktopDir);

const setup = path.join(repoRoot, "release", "BodyMeasurementSetup.exe");
if (!fs.existsSync(setup)) {
  fail(`Installer was not written to ${setup}`);
}
copySideBySideWeights();
console.log(`Installer ready: ${setup}`);
console.log(
  "Large weights are beside the exe under release\\models. Install from that folder so setup can paste them into the app."
);
