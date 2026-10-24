"use strict";

// Draws assets/icon.png: `npx electron scripts/make-icon.js`.
// The mark is the sediment itself: dots stacked in columns, in the four ink
// colours. Rendered in a window that is never shown.

const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, BrowserWindow } = require("electron");

const COLUMNS = [
  ["#2f6bff", "#2f6bff"],
  ["#2f6bff", "#f0349a", "#00a878", "#f29d00"],
  ["#2f6bff", "#00a878", "#f0349a"],
];

const dots = COLUMNS.map((col) => `<div class="col">${col.map((c) => `<i style="background:${c}"></i>`).join("")}</div>`).join("");

const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1024px; height: 1024px; background: transparent; }
  .tile { position: absolute; inset: 100px; border-radius: 186px; background: linear-gradient(160deg, #ffffff, #e6e9f0);
          box-shadow: 0 18px 36px rgb(20 26 44 / .28), inset 0 0 0 3px rgb(255 255 255 / .9);
          display: flex; align-items: flex-end; justify-content: center; gap: 46px; padding-bottom: 168px; }
  .col { display: flex; flex-direction: column-reverse; gap: 22px; }
  i { display: block; width: 112px; height: 112px; border-radius: 50%; }
</style><div class="tile">${dots}</div>`;

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-icon-")));
if (app.dock) app.dock.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "assets", "icon.png");
  fs.writeFileSync(out, image.resize({ width: 1024, height: 1024 }).toPNG());
  console.log(out);
  app.exit(0);
});
