"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  shell,
} = require("electron");

const config = require("./core/config");
const library = require("./core/library");
const dotjar = require("./core/dotjar");
const { createSession } = require("./core/session");
const { pathToFileURL } = require("url");
const words = require("./overlay/words");

const argv = process.argv.slice(1);
const flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];
const DEMO = argv.includes("--demo");
const SHOT = argv.find((a) => a === "--shot" || a.startsWith("--shot="));
const DEV = argv.includes("--dev");
const SMOKE = argv.includes("--smoke"); // start everything, show nothing, report, quit
const HEADLESS = Boolean(SHOT) || SMOKE;
const isMac = process.platform === "darwin";

let win = null;
let tray = null;
let cfg = config.load();
// Every word the shell itself says. The language is settled once the app is
// ready, when the system's own language can be asked.
let lang = config.resolveLanguage(cfg, flag("lang"));
let T = words.copy(lang, cfg.wording);
let loaded = false;
let holdOpen = false; // a native dialog is up; losing focus must not close the veil
let session = null;

app.setName("dotjar");

if (HEADLESS || DEMO) {
  // Screenshot, smoke and demo runs keep to themselves: their own profile, and
  // no nudging of a copy of the app the person already has running.
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-run-")));
  app.whenReady().then(start);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showVeil());
  app.whenReady().then(start);
}

function start() {
  lang = flag("lang") ? config.resolveLanguage({ language: flag("lang") }) : config.resolveLanguage(cfg, app.getLocale());
  T = words.copy(lang, cfg.wording);
  // Undoing a keep puts the note in the system trash rather than deleting it.
  session = createSession({ language: lang, onView: (view) => updatePresence(view), discard: (file) => shell.trashItem(file) });

  const theme = flag("theme");
  if (theme === "light" || theme === "dark") nativeTheme.themeSource = theme;

  if (isMac && app.dock) {
    if (HEADLESS) {
      app.dock.hide();
    } else {
      const icon = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "icon.png"));
      if (!icon.isEmpty()) app.dock.setIcon(icon);
    }
  }

  createWindow();
  registerIpc();
  if (!SHOT) {
    createMenus();
    registerShortcuts();
  }
  win.webContents.once("did-finish-load", () => {
    loaded = true;
    if (SHOT) takeShot();
    else if (SMOKE) smoke();
    else {
      showVeil();
      announce();
    }
  });

  // Every ordinary way back to an app has to bring the veil back: clicking
  // its Dock icon, switching to it, launching it a second time.
  app.on("activate", () => showVeil());
  app.on("did-become-active", () => showVeil());
  app.on("before-quit", () => {
    app.isQuitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  // Putting the veil away is not quitting.
  app.on("window-all-closed", (e) => e.preventDefault());
}

function announce() {
  const key = accelLabel(cfg.hotkey);
  console.log(T.announce(key, T.keep));
}

function accelLabel(accelerator) {
  const names = isMac ? { Alt: "⌥", Shift: "⇧", Command: "⌘", Cmd: "⌘", CommandOrControl: "⌘", CmdOrCtrl: "⌘", Control: "⌃", Ctrl: "⌃" } : {};
  return String(accelerator || "")
    .split("+")
    .map((k) => names[k] || (isMac ? k : k + "+"))
    .join("")
    .replace(/\+$/, "");
}

function createWindow() {
  win = new BrowserWindow({
    ...(SHOT ? { width: Number(flag("width")) || 1440, height: Number(flag("height")) || 900 } : {}),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    // The blur comes from the system, so whatever is on screen shows through.
    vibrancy: "fullscreen-ui",
    visualEffectState: "active",
    backgroundMaterial: "acrylic",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [DEMO ? "--dotjar-demo" : "--dotjar-live"],
    },
  });
  if (!HEADLESS) {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  const query = {};
  if (flag("demo-state")) query.state = flag("demo-state");
  if (flag("view")) query.view = flag("view");
  if (flag("words")) query.words = flag("words");
  if (flag("lang")) query.lang = flag("lang");
  win.loadFile(path.join(__dirname, "overlay", "overlay.html"), { query });
  win.on("blur", () => {
    if (!holdOpen && !DEV && !HEADLESS) hideVeil();
  });
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      hideVeil();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  if (DEV) win.webContents.openDevTools({ mode: "detach" });
}

function showVeil() {
  if (!win || !loaded || HEADLESS || win.isVisible()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win.setBounds(display.bounds);
  win.show();
  win.focus();
  if (isMac) app.focus({ steal: true });
  win.webContents.send("dotjar:shown");
}

function hideVeil() {
  if (!win || !win.isVisible()) return;
  win.hide();
  // Hand focus back to whatever the person was working in. The app stays in
  // the Dock and the menu bar, which is how they get the veil back.
  if (isMac) app.hide();
}

function toggleVeil() {
  if (win && win.isVisible() && win.isFocused()) hideVeil();
  else showVeil();
}

// ------------------------------------------------------- menu bar and Dock

// A column of three dots, drawn in code as a template image.
function trayIcon() {
  const size = 36;
  const buf = Buffer.alloc(size * size * 4);
  for (const cy of [8, 18, 28]) {
    for (let y = cy - 4; y <= cy + 4; y++) {
      for (let x = 14; x <= 22; x++) {
        if ((x - 18) ** 2 + (y - cy) ** 2 <= 16.5) buf[(y * size + x) * 4 + 3] = 255;
      }
    }
  }
  const image = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  image.setTemplateImage(true);
  return image;
}

function commands() {
  return [
    { label: T.menuToday, accelerator: cfg.hotkey, registerAccelerator: false, click: showVeil },
    { label: T.openLib(T), click: () => openLibrary().catch(() => {}) },
    { label: T.menuCapture, accelerator: cfg.captureHotkey, registerAccelerator: false, click: captureClipboard },
    { type: "separator" },
    { label: T.menuNotes, click: () => openFolder(config.depositDir(session.config)) },
    { label: T.menuData, click: () => openFolder(config.dataDir()) },
  ];
}

function createMenus() {
  tray = new Tray(trayIcon());
  tray.setToolTip(`dotjar ${T.title}`);
  if (isMac) tray.setTitle(trayTitle());
  tray.setContextMenu(Menu.buildFromTemplate([...commands(), { type: "separator" }, { label: T.menuQuit, click: () => app.quit() }]));

  // A real application menu: Edit keeps copy working in the drafts, and the
  // app menu gives quitting its usual place.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "dotjar", submenu: [...commands(), { type: "separator" }, { role: "hide", label: T.menuHide }, { role: "quit", label: T.menuQuit }] },
      { role: "editMenu" },
    ])
  );
  if (isMac && app.dock) app.dock.setMenu(Menu.buildFromTemplate(commands().slice(0, 2)));
}

// The menu bar shows how many candidates are waiting, so the app has a
// presence even while the veil is away.
let waiting = 0;

function updatePresence(view) {
  if (!tray || !isMac || !view) return;
  waiting = view.candidates.length;
  tray.setTitle(trayTitle());
}

function trayTitle() {
  return waiting ? ` ${T.tabOpen} ${waiting}` : ` ${T.keep}`;
}

function openFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
}

function registerShortcuts() {
  const tryRegister = (accelerator, fn) => {
    if (!accelerator) return false;
    try {
      return globalShortcut.register(accelerator, fn);
    } catch {
      return false;
    }
  };
  if (!tryRegister(cfg.hotkey, toggleVeil) && !SMOKE) {
    console.error(`快捷键 ${accelLabel(cfg.hotkey)} 注册失败，可能被别的应用占用。在 ~/.dotjar/config.json 里改 hotkey。`);
  }
  tryRegister(cfg.captureHotkey, captureClipboard);
}

// Copy something in any app, press the capture key: it joins today's material.
function captureClipboard() {
  const text = clipboard.readText();
  const ok = Boolean(text && text.trim());
  if (ok) dotjar.capture(text, {}, session.config);
  if (tray && isMac) {
    tray.setTitle(` ${ok ? T.traySaved : T.trayEmpty}`);
    setTimeout(() => tray && tray.setTitle(trayTitle()), 1600);
  }
  if (ok && win && win.isVisible()) win.webContents.send("dotjar:captured");
  return ok;
}

// Opens in the browser; with an anchor, at that entry.
async function openLibrary(anchor) {
  const file = session.library();
  if (typeof anchor === "string" && /^n[0-9a-z]+$/.test(anchor)) {
    await shell.openExternal(`${pathToFileURL(file).href}#${anchor}`);
    return true;
  }
  const failed = await shell.openPath(file);
  if (failed) throw new Error(failed);
  return true;
}

// --------------------------------------------------------------------- ipc
// The page asks, the session answers; only what needs the desktop (the
// clipboard, a folder dialog, the Finder, the window itself) is handled here.
// In demo mode the page answers its own data calls from a made-up day.

function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err), code: err && err.code };
      }
    });

  handle("dotjar:meta", () => ({ demo: DEMO, ...session.engine(), hotkey: cfg.hotkey, captureHotkey: cfg.captureHotkey, mac: isMac, wording: cfg.wording, language: lang }));
  handle("dotjar:today", (back) => session.today(back));
  handle("dotjar:distill", (days) => session.distill(days));
  handle("dotjar:calendar", (month) => session.calendar(month));
  handle("dotjar:distilling", () => session.isDistilling());
  handle("dotjar:set-engine", (id) => session.setEngine(id));
  handle("dotjar:keep", (id) => session.keep(id));
  handle("dotjar:skip", (id) => session.skip(id));
  handle("dotjar:reopen", (id) => session.reopen(id));

  handle("dotjar:copy", (text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });

  handle("dotjar:paste", () => {
    const text = clipboard.readText();
    if (!text || !text.trim()) throw new Error("剪贴板里没有文字");
    return session.capture(text);
  });

  handle("dotjar:choose-deposit-dir", async () => {
    holdOpen = true;
    let chosen = null;
    try {
      const res = await dialog.showOpenDialog(win, {
        title: T.chooseFolder,
        defaultPath: config.depositDir(session.config),
        properties: ["openDirectory", "createDirectory"],
      });
      if (!res.canceled && res.filePaths[0]) chosen = res.filePaths[0];
    } finally {
      holdOpen = false;
      if (win && win.isVisible()) win.focus();
    }
    return chosen ? session.setDepositDir(chosen) : session.today();
  });

  handle("dotjar:reveal", (file) => {
    if (typeof file === "string" && path.isAbsolute(file) && fs.existsSync(file)) shell.showItemInFolder(file);
    return true;
  });

  handle("dotjar:library", (anchor) => openLibrary(anchor));

  handle("dotjar:hide", () => {
    hideVeil();
    return true;
  });
}

// -------------------------------------------------- headless verification

async function smoke() {
  const view = await win.webContents.executeJavaScript(
    "window.dotjarBridge.today().then((v) => ({ day: v.day, sessions: v.stats.sessions, settled: v.settled.length, open: v.candidates.length }))"
  );
  console.log(
    JSON.stringify({
      ok: true,
      hotkey: globalShortcut.isRegistered(cfg.hotkey),
      capture: globalShortcut.isRegistered(cfg.captureHotkey),
      tray: Boolean(tray),
      library: fs.existsSync(library.libraryPath()),
      view,
    })
  );
  app.exit(0);
}

async function takeShot() {
  const out = path.resolve(SHOT.includes("=") ? SHOT.split("=")[1] : path.join(__dirname, "..", "shots", "veil.png"));
  // Never shown: a screenshot run must not take the keyboard from whoever is
  // working on this machine.
  win.webContents.send("dotjar:shown");
  await new Promise((r) => setTimeout(r, Number(flag("wait")) || 1800));
  const script = flag("eval");
  if (script) {
    await win.webContents.executeJavaScript(Buffer.from(script, "base64").toString("utf8"));
    await new Promise((r) => setTimeout(r, Number(flag("wait")) || 900));
  }
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.resize({ width: win.getContentSize()[0] }).toPNG());
  console.log(out);
  app.exit(0);
}
