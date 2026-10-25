"use strict";
// Copied verbatim from jsmdcui/src/platform/clipboard.js (MIT).
// Keep the function below unchanged; inject its existing command helpers.
module.exports = function createPowerShellClipboard(shell, runSync, outputOrThrow) {
function powershellClipboard(shell) {
  return {
    name: "powershell",
    // Get-Clipboard -Raw appends \r\n to stdout; strip exactly one trailing line ending.
    read: () => outputOrThrow(runSync([shell, "-NoProfile", "-Command", "Get-Clipboard -Raw"], {})).replace(/\r?\n$/, ""),
    write: (text) => {
      text=(text+'').replaceAll("'","''") ;
      return runSync([shell, "-NoProfile", "-Command", `Set-Clipboard '${text}'`], { stdout: "ignore" }).ok ;
    },
  };
}

return powershellClipboard(shell);
};
