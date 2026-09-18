export const DEFAULT_COMMON_SETTINGS = {
  autoindent: true,
  autosu: false,
  backup: true,
  backupdir: "",
  basename: false,
  colorcolumn: 0,
  cursorline: true,
  detectlimit: 100,
  diffgutter: false,
  encoding: "utf-8",
  eofnewline: true,
  fastdirty: false,
  fileformat: defaultFileFormat(),
  filetype: "unknown",
  hlsearch: false,
  hltaberrors: false,
  hltrailingws: false,
  ignorecase: true,
  incsearch: true,
  indentchar: " ",
  keepautoindent: false,
  matchbrace: true,
  matchbraceleft: true,
  matchbracestyle: "underline",
  mkparents: false,
  pageoverlap: 2,
  permbackup: false,
  readonly: false,
  relativeruler: false,
  reload: "prompt",
  rmtrailingws: false,
  ruler: true,
  savecursor: false,
  saveundo: false,
  scrollbar: false,
  scrollmargin: 3,
  scrollspeed: 2,
  showchars: "",
  smartpaste: true,
  softwrap: true,
  splitbottom: true,
  splitright: true,
  statusformatl: "$(filename) $(modified)$(overwrite)($(line),$(col)) $(status.paste)| ft:$(opt:filetype) | $(opt:fileformat) | $(opt:encoding)",
  statusformatr: "$(bind:ToggleKeyMenu): bindings, $(bind:ToggleHelp): help",
  statusline: true,
  syntax: true,
  tabmovement: false,
  tabsize: 4,
  tabstospaces: false,
  truecolor: "auto",
  useprimary: true,
  wordwrap: false,
};

export const DEFAULT_GLOBAL_ONLY_SETTINGS = {
  autosave: 0,
  clipboard: "external",
  colorscheme: "default",
  cursorshape: "block",
  savehistory: true,
  divchars: "|-",
  divreverse: true,
  fakecursor: process.platform === "win32",
  helpsplit: "hsplit",
  infobar: true,
  keymenu: false,
  lockbindings: false,
  mouse: true,
  multiopen: "tab",
  parsecursor: false,
  paste: false,
  pluginchannels: ["https://raw.githubusercontent.com/micro-editor/plugin-channel/master/channel.json"],
  pluginrepos: [],
  savehistory: true,
  scrollbarchar: "|",
  sucmd: "sudo",
  tabhighlight: false,
  tabreverse: true,
  xterm: false,
};

export const OPTION_CHOICES = {
  clipboard: ["internal", "external", "terminal"],
  cursorshape: [
    "default",
    "block", "blinking-block",
    "underline", "blinking-underline",
    "bar", "blinking-bar",
  ],
  fileformat: ["unix", "dos"],
  helpsplit: ["hsplit", "vsplit"],
  matchbracestyle: ["underline", "highlight"],
  multiopen: ["tab", "hsplit", "vsplit"],
  reload: ["prompt", "auto", "disabled"],
  truecolor: ["auto", "on", "off"],
};

// Settings that are buffer-local only and must never be written to the global config file.
// Mirrors Go micro's config.LocalSettings.
export const LOCAL_SETTINGS = new Set(["readonly", "filetype", "fileformat", "encoding"]);

export function defaultAllSettings() {
  return { ...DEFAULT_COMMON_SETTINGS, ...DEFAULT_GLOBAL_ONLY_SETTINGS };
}

function defaultFileFormat() {
  return process.platform === "win32" ? "dos" : "unix";
}
