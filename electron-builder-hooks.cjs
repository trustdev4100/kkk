"use strict";

// electron-vite already writes the desktop app to desktop/out.
// Returning false tells electron-builder the app does not need a production
// node_modules tree. That skips `npm list` (PowerShell on nvm4w often returns
// no JSON, which aborts the pack) and skips copying node_modules into the asar.
function beforeBuild() {
  console.log(
    "beforeBuild: using bundled desktop/out; skipping npm list and node_modules copy"
  );
  return false;
}

module.exports = { beforeBuild };
