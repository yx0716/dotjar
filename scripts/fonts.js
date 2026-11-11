#!/usr/bin/env node
"use strict";

// Cuts the two typefaces the interface carries down to the characters it
// needs, so that they can travel with the project instead of having to be
// installed.
//
//   node scripts/fonts.js                  write the lists of characters
//   node scripts/fonts.js ~/Library/Fonts  and cut the fonts found there
//
// Cutting needs `pyftsubset`, from Python's fonttools, and the original
// files: Huiwenmincho-improved.otf, LXGWWenKai-Regular.ttf and
// LXGWWenKai-Medium.ttf.
//
//   汇文明朝体  the interface's own titles and the line of verse. Only the
//              characters those titles use: the face draws some simplified
//              characters in an old form that reads as another character
//              (让 comes out looking like 註), so it is kept to text that is
//              known in advance. Anything else falls through to the next face.
//   霞鹜文楷    whatever comes out of the day's work, where any character may
//              turn up: all of GB2312, Latin, and the usual punctuation.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const words = require("../src/overlay/words");

const OUT = path.join(__dirname, "..", "src", "overlay", "fonts");
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("");
// Drawn by 汇文明朝体 in a form that reads as a different character.
const MISDRAWN = "让认论证讲";

// Every title the interface itself writes in Chinese: in each wording, and
// for today, yesterday and an earlier day.
function mingTitles() {
  const out = new Set();
  const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  for (const wording of words.names) {
    for (const [back, key] of [[0, "2026-11-11"], [1, "2026-11-10"], [3, "2026-11-08"]]) {
      const T = words.copy("zh", wording, back, key);
      const fixed = [T.overviewTitle(5, 7), T.overviewTitle(5, 0), T.overviewRough(9), T.roughTitleDone(3), T.roughTitle, T.loading, T.loadFail, T.distilling, T.batching, T.distillFail];
      // The jar's own page is headed with what the jar is called.
      const more = [T.nothingYet, T.decidedTitle, T.nothingTitle, T.doneToday(3), T.noneToday, T.restHead, T.restOver, T.recapTitle(50), T.epigraph, T.library];
      for (const s of [...fixed, ...more, ...week.map((d) => T.switchingTo(T.date(d)))]) out.add(String(s));
    }
  }
  return [...out];
}

// The titles' own characters, what a date or a count can bring, and plain Latin.
function mingChars() {
  const set = new Set([...mingTitles().join(""), ...ASCII, ..."0123456789月日周一二三四五六天昨今年，。、；：？！「」《》（）…—·"]);
  for (const c of MISDRAWN) set.delete(c);
  return [...set].sort().join("");
}

function kaiChars() {
  const set = new Set(ASCII);
  const gbk = new TextDecoder("gbk");
  // The 6763 characters of GB2312.
  for (let a = 0xb0; a <= 0xf7; a++) for (let b = 0xa1; b <= 0xfe; b++) set.add(gbk.decode(Uint8Array.of(a, b)));
  for (const [lo, hi] of [[0xa0, 0xff], [0x2010, 0x2027], [0x2030, 0x203a], [0x2190, 0x2199], [0x2460, 0x2473], [0x3000, 0x303f], [0xff00, 0xff5e], [0xffe0, 0xffe5]]) {
    for (let c = lo; c <= hi; c++) set.add(String.fromCharCode(c));
  }
  for (const c of "×÷≈≠≤≥°′″℃→←↑↓✓✗★☆●○■□▲△♪") set.add(c);
  set.delete("�");
  return [...set].sort().join("");
}

const FONTS = [
  { from: "Huiwenmincho-improved.otf", to: "huiwen-mincho-titles.woff", list: "huiwen-mincho-titles.txt", chars: mingChars, extra: ["--desubroutinize"] },
  { from: "LXGWWenKai-Regular.ttf", to: "lxgw-wenkai-regular.woff", list: "lxgw-wenkai.txt", chars: kaiChars, extra: [] },
  { from: "LXGWWenKai-Medium.ttf", to: "lxgw-wenkai-medium.woff", list: "lxgw-wenkai.txt", chars: kaiChars, extra: [] },
];

function main() {
  const source = process.argv[2];
  fs.mkdirSync(OUT, { recursive: true });
  for (const font of FONTS) {
    const list = path.join(OUT, font.list);
    fs.writeFileSync(list, font.chars());
    if (!source) continue;
    const args = [
      path.join(source.replace(/^~(?=\/|$)/, require("os").homedir()), font.from),
      `--text-file=${list}`,
      `--output-file=${path.join(OUT, font.to)}`,
      "--flavor=woff",
      "--no-hinting",
      "--notdef-outline",
      // The names carry the copyright and the licence, which have to travel with the font.
      "--name-IDs=*",
      "--name-languages=*",
      "--layout-features=kern,liga,calt,locl,ccmp,mark,mkmk",
      ...font.extra,
    ];
    const res = spawnSync("pyftsubset", args, { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`pyftsubset did not cut ${font.from}`);
    console.log(`${font.to}  ${(fs.statSync(path.join(OUT, font.to)).size / 1e6).toFixed(2)} MB`);
  }
  if (!source) console.log("Wrote the lists of characters. Pass the folder holding the original fonts to cut them too.");
}

if (require.main === module) main();

module.exports = { mingTitles, mingChars, kaiChars, MISDRAWN };
