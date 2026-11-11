"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const fonts = require("../scripts/fonts");

const DIR = path.join(__dirname, "..", "src", "overlay", "fonts");
const listed = (name) => new Set(fs.readFileSync(path.join(DIR, name), "utf8"));

test("the Ming face carries every character of the interface's own titles", () => {
  // The font was cut from this list. A title changed in words.js without
  // cutting the font again would show the new characters in the other face.
  const carried = listed("huiwen-mincho-titles.txt");
  const missing = new Set();
  for (const title of fonts.mingTitles()) for (const c of title) if (!carried.has(c) && !fonts.MISDRAWN.includes(c)) missing.add(c);
  assert.deepEqual([...missing], [], "run `node scripts/fonts.js ~/Library/Fonts` after changing a title");
  assert.ok(fonts.mingTitles().some((t) => t.includes("维天有汉")), "the line of verse is one of them");
  // The characters it draws as something else are left to the other face.
  for (const c of fonts.MISDRAWN) assert.ok(!carried.has(c), c);
});

test("the hand carries the common characters, and the fonts are where the page looks for them", () => {
  const carried = listed("lxgw-wenkai.txt");
  for (const c of "让认论证讲的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞") assert.ok(carried.has(c), c);
  for (const c of "agent AGENT 0123456789 ，。、；：「」？！（）…—→") assert.ok(carried.has(c), JSON.stringify(c));
  for (const file of ["huiwen-mincho-titles.woff", "lxgw-wenkai-regular.woff", "lxgw-wenkai-medium.woff"]) {
    const head = fs.readFileSync(path.join(DIR, file)).subarray(0, 4).toString("latin1");
    assert.equal(head, "wOFF", file);
    assert.ok(fs.readFileSync(path.join(__dirname, "..", "src", "overlay", "overlay.css"), "utf8").includes(`url("fonts/${file}")`), file);
    assert.ok(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8").includes(`"/fonts/${file}"`), file);
  }
  // The page is allowed to load them, and nothing from anywhere else.
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "overlay", "overlay.html"), "utf8"), /default-src 'none'.*font-src 'self'/);
});
