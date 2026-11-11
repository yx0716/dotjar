#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const release = require("../src/update/release");
const source = path.resolve(__dirname, "..");
const runtime = require("../packaging/macos/node-runtime.json");
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

async function build({ arch = process.arch, version = require("../package.json").version, signed = false } = {}) {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(arch) || !/^\d+\.\d+\.\d+$/.test(version)) throw Error("Requires macOS, arm64/x64 and a stable release version");
  const appIdentity = process.env.DOTJAR_APP_SIGN_ID;
  const installerIdentity = process.env.DOTJAR_INSTALLER_SIGN_ID;
  const notaryProfile = process.env.DOTJAR_NOTARY_PROFILE;
  if (signed && (!appIdentity || !installerIdentity || !notaryProfile)) throw Error("Signed distribution requires DOTJAR_APP_SIGN_ID, DOTJAR_INSTALLER_SIGN_ID and DOTJAR_NOTARY_PROFILE; no unsigned fallback");
  const out = path.join(source, "dist/macos", arch);
  fs.mkdirSync(out, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-pkg-"));
  try {
    const app = path.join(work, "root/Applications/dotjar.app");
    const contents = path.join(app, "Contents"), resources = path.join(contents, "Resources"), macos = path.join(contents, "MacOS");
    fs.mkdirSync(resources, { recursive: true }); fs.mkdirSync(macos);
    const host = path.join(resources, "host"), payload = path.join(resources, "payload");
    fs.mkdirSync(host); fs.mkdirSync(payload);
    for (const name of ["src", "assets", "package.json", "LICENSE"]) fs.cpSync(path.join(source, name), path.join(host, name), { recursive: true });
    // The embedded release must already exist and be signed. Never silently
    // package an unreviewed working tree as the user's managed release.
    const envelope = JSON.parse((await release.download(`https://github.com/yx0716/dotjar/releases/download/v${version}/dotjar-update.json`, 128 * 1024)).toString());
    const manifest = release.verify(envelope, require("../assets/update-keys.json"), "darwin", arch);
    if (manifest.version !== version) throw Error("Embedded release version mismatch");
    const bytes = await release.download(manifest.artifact.url, release.MAX_PACKAGE);
    release.unpack(bytes, manifest, path.join(work, "verified-release"));
    fs.writeFileSync(path.join(payload, "dotjar-update.json"), JSON.stringify(envelope));
    fs.writeFileSync(path.join(payload, manifest.artifact.name), bytes);

    const tarName = `node-v${runtime.version}-darwin-${arch}.tar.gz`;
    const cache = path.join(source, "dist/cache"); fs.mkdirSync(cache, { recursive: true });
    const tar = path.join(cache, tarName);
    if (!fs.existsSync(tar)) {
      const response = await fetch(`https://nodejs.org/dist/v${runtime.version}/${tarName}`, { redirect: "error", signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error(`Node download HTTP ${response.status}`);
      const chunks = []; let total = 0;
      for await (const chunk of response.body) { total += chunk.length; if (total > 80 * 1024 * 1024) throw Error("Node archive too large"); chunks.push(chunk); }
      const downloaded = Buffer.concat(chunks);
      if (crypto.createHash("sha256").update(downloaded).digest("hex") !== runtime.sha256[arch]) throw Error("Node runtime checksum mismatch");
      fs.writeFileSync(tar, downloaded);
    }
    if (crypto.createHash("sha256").update(fs.readFileSync(tar)).digest("hex") !== runtime.sha256[arch]) throw Error("Cached Node runtime checksum mismatch");
    run("/usr/bin/tar", ["-xzf", tar, "-C", work]);
    const nodeRoot = path.join(work, `node-v${runtime.version}-darwin-${arch}`);
    fs.copyFileSync(path.join(nodeRoot, "bin/node"), path.join(macos, "node")); fs.chmodSync(path.join(macos, "node"), 0o755);
    fs.copyFileSync(path.join(nodeRoot, "LICENSE"), path.join(payload, "NODE-LICENSE"));
    run("/usr/bin/xcrun", ["clang", "-O2", "-fobjc-arc", "-target", `${arch === "x64" ? "x86_64" : "arm64"}-apple-macosx11.0`, "-framework", "Cocoa", path.join(source, "packaging/macos/Launcher.m"), "-o", path.join(macos, "dotjar")]);
    const iconset = path.join(work, "dotjar.iconset"); fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
      run("/usr/bin/sips", ["-z", String(size * scale), String(size * scale), path.join(source, "assets/icon-star.png"), "--out", path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`)]);
    }
    run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "dotjar.icns")]);
    fs.copyFileSync(path.join(source, "assets/brand-lockup.png"), path.join(resources, "brand-lockup.png"));
    fs.writeFileSync(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.dotjar.launcher</string>
<key>CFBundleName</key><string>dotjar</string>
<key>CFBundleDisplayName</key><string>dotjar</string>
<key>CFBundleExecutable</key><string>dotjar</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundleIconFile</key><string>dotjar.icns</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
    const identity = signed ? appIdentity : "-";
    run("/usr/bin/codesign", ["--force", "--sign", identity, "--options", "runtime", ...(signed ? ["--timestamp"] : []), "--entitlements", path.join(source, "packaging/macos/node-entitlements.plist"), path.join(macos, "node")]);
    run("/usr/bin/codesign", ["--force", "--sign", identity, "--options", "runtime", ...(signed ? ["--timestamp"] : []), app]);
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);

    // Disable Installer's relocation search: another test copy of dotjar.app
    // must not redirect an install away from /Applications.
    const components = path.join(work, "components.plist");
    fs.writeFileSync(components, `<?xml version="1.0"?><plist version="1.0"><array><dict><key>RootRelativeBundlePath</key><string>Applications/dotjar.app</string><key>BundleIsRelocatable</key><false/><key>BundleIsVersionChecked</key><true/><key>BundleOverwriteAction</key><string>upgrade</string></dict></array></plist>`);
    const component = path.join(work, "dotjar-component.pkg");
    run("/usr/bin/pkgbuild", ["--root", path.join(work, "root"), "--component-plist", components, "--identifier", `com.dotjar.installer.${arch}`, "--version", version, "--install-location", "/", component]);
    const pages = path.join(work, "pages"); fs.mkdirSync(pages);
    run("/usr/bin/sips", ["-z", "180", "360", "--setProperty", "dpiWidth", "144", "--setProperty", "dpiHeight", "144", path.join(source, "assets/brand-lockup.png"), "--out", path.join(pages, "brand-lockup.png")]);
    const html = text => `<!doctype html><html lang="zh"><meta charset="utf-8"><style>body{font:13px -apple-system,sans-serif;line-height:1.55;color:#253047;padding:0 12px}h1{font-size:20px}p{margin:10px 0}</style>${text}</html>`;
    fs.writeFileSync(path.join(pages, "welcome.html"), html(`<h1>把 dotjar 装进你的 Mac</h1><p>安装后，从「应用程序」双击 dotjar，即可在浏览器中使用。</p><p>自带运行环境，无需安装 Node.js 或 Git。首次打开无需下载程序；使用模型进行打捞仍需配置相应服务。</p><p>已有笔记和记录会保留，不会自动开启登录启动。</p>${signed ? "" : "<p><b>未公证测试版：</b>尚无 Apple 开发者签名和公证，下载后可能被 macOS 拦截。仅用于测试。</p>"}`));
    fs.writeFileSync(path.join(pages, "conclusion.html"), html("<h1>安装完成</h1><p>打开「访达 → 应用程序 → dotjar」，开始使用。</p><p>第一次打开会准备你的个人程序目录，然后打开网页。以后继续双击 dotjar；版本升级可在网页的「更新」中完成。</p><p>关闭浏览器后，后台服务仍会运行。卸载和关闭后台服务的方法见安装帮助。</p>"));
    const distribution = path.join(work, "distribution.xml");
    fs.writeFileSync(distribution, `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
<title>dotjar ${version}${signed ? "" : " · 未公证测试版"}</title>
<background file="brand-lockup.png" alignment="bottomleft" scaling="none"/>
<background-darkAqua file="brand-lockup.png" alignment="bottomleft" scaling="none"/>
<welcome file="welcome.html" mime-type="text/html"/><conclusion file="conclusion.html" mime-type="text/html"/>
<options customize="never" require-scripts="false" hostArchitectures="${arch === "x64" ? "x86_64" : "arm64"}"/>
<domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>
<allowed-os-versions><os-version min="11.0"/></allowed-os-versions>
<choices-outline><line choice="default"/></choices-outline>
<choice id="default" visible="false"><pkg-ref id="com.dotjar.installer.${arch}"/></choice>
<pkg-ref id="com.dotjar.installer.${arch}" version="${version}" onConclusion="none">dotjar-component.pkg</pkg-ref>
</installer-gui-script>`);
    const name = `dotjar-${version}-macOS-${arch}${signed ? "" : "-unsigned-test"}.pkg`;
    const pkg = path.join(out, name);
    run("/usr/bin/productbuild", ["--distribution", distribution, "--resources", pages, "--package-path", work, ...(signed ? ["--sign", installerIdentity] : []), pkg]);
    if (signed) {
      run("/usr/bin/xcrun", ["notarytool", "submit", pkg, "--keychain-profile", notaryProfile, "--wait"]);
      run("/usr/bin/xcrun", ["stapler", "staple", pkg]);
      run("/usr/bin/xcrun", ["stapler", "validate", pkg]);
      run("/usr/sbin/spctl", ["--assess", "--type", "install", "--verbose", pkg]);
    }
    // Keep the app for isolated smoke tests without installing as root.
    fs.rmSync(path.join(out, "dotjar.app"), { recursive: true, force: true });
    fs.cpSync(app, path.join(out, "dotjar.app"), { recursive: true });
    const sha = crypto.createHash("sha256").update(fs.readFileSync(pkg)).digest("hex");
    fs.writeFileSync(pkg + ".sha256", `${sha}  ${name}\n`);
    console.log(JSON.stringify({ pkg, arch, version, notarized: signed, sha256: sha }));
    return pkg;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const arch = args.find(a => a.startsWith("--arch="))?.slice(7) || process.arch;
  const version = args.find(a => a.startsWith("--version="))?.slice(10);
  const unknown = args.filter(a => !a.startsWith("--arch=") && !a.startsWith("--version=") && a !== "--signed");
  if (unknown.length) { console.error(`Unknown options: ${unknown.join(" ")}`); process.exitCode = 1; }
  else build({ arch, version, signed: args.includes("--signed") }).catch(err => { console.error(err.message); process.exitCode = 1; });
}
module.exports = { build };
