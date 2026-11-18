// Records a scene as crisp frames (Chrome's screencast), with an overlay drawn into the page:
// the section tag, a caption, a visible cursor and a spotlight. Waits can be marked to play fast.
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const W = 1600;
const H = 900;
// Drawn at 1.2x, so the frames are 1920x1080 and text stays sharp at the player's 1600x900.
// SCENES names the output folder (the voiced cut records into its own); NO_CAPTIONS=1 records
// the caption times without drawing the captions, for a version whose words are spoken.
const OUT = path.join(__dirname, process.env.SCENES === "voice" ? "scenes-voice" : "scenes");
const DRAW_CAPTIONS = process.env.NO_CAPTIONS !== "1";

const OVERLAY = `(() => {
  if (window.__ov) return;
  window.__ov = true;
  const css = \`
  #ov-tag, #ov-cap, #ov-cur, #ov-spot { position: fixed; z-index: 2147483647; pointer-events: none; }
  #ov-tag { top: 76px; right: 20px; padding: 8px 15px; border-radius: 9px; font: 700 14px/1 "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; box-shadow: 0 10px 30px -14px rgb(0 0 0 / 45%); transition: opacity .4s; }
  #ov-tag.product { background: #2c5cc5; color: #fff; } #ov-tag.eng { background: #c4532f; color: #fff; } #ov-tag.sec { background: #23784a; color: #fff; } #ov-tag.repo { background: #24231f; color: #fff; }
  #ov-cap { left: 50%; bottom: 26px; transform: translateX(-50%); max-width: 1180px; padding: 13px 24px; border-radius: 16px; background: rgb(28 27 24 / 92%); color: #fff; font: 500 23px/1.38 "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif; text-align: center; box-shadow: 0 20px 50px -20px rgb(0 0 0 / 60%); transition: opacity .35s; }
  #ov-cap b { color: #ffb39d; font-weight: 700; }
  #ov-cur { width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: rgb(226 121 95 / 35%); border: 2px solid #e2795f; transition: transform .15s; left: -50px; top: -50px; }
  #ov-cur.down { transform: scale(.7); background: rgb(226 121 95 / 65%); }
  #ov-spot { border: 3px solid #e2795f; border-radius: 14px; box-shadow: 0 0 0 9999px rgb(20 19 17 / 28%); transition: all .45s cubic-bezier(.4,0,.2,1); opacity: 0; }
  \`;
  const add = () => {
    if (document.getElementById("ov-cap")) return;
    const s = document.createElement("style"); s.textContent = css; document.documentElement.appendChild(s);
    for (const id of ["ov-spot", "ov-tag", "ov-cap", "ov-cur"]) { const d = document.createElement("div"); d.id = id; d.style.opacity = id === "ov-cur" ? "1" : "0"; document.documentElement.appendChild(d); }
    const st = JSON.parse(sessionStorage.getItem("__ov") || "{}");
    if (st.tag) window.__tag(st.tag, st.tagClass);
    if (st.cap) window.__cap(st.cap);
  };
  window.__save = (k, v) => { try { const st = JSON.parse(sessionStorage.getItem("__ov") || "{}"); st[k] = v; sessionStorage.setItem("__ov", JSON.stringify(st)); } catch {} };
  window.__tag = (text, cls) => { const t = document.getElementById("ov-tag"); if (!t) return; t.textContent = text; t.className = cls; t.style.opacity = text ? "1" : "0"; window.__save("tag", text); window.__save("tagClass", cls); };
  window.__cap = (html) => { const c = document.getElementById("ov-cap"); if (!c) return; c.innerHTML = html; c.style.opacity = html ? "1" : "0"; window.__save("cap", html); };
  window.__spot = (r) => { const s = document.getElementById("ov-spot"); if (!s) return; if (!r) { s.style.opacity = "0"; return; } const p = 8; Object.assign(s.style, { left: (r.x - p) + "px", top: (r.y - p) + "px", width: (r.width + 2 * p) + "px", height: (r.height + 2 * p) + "px", opacity: "1" }); };
  document.addEventListener("mousemove", (e) => { const c = document.getElementById("ov-cur"); if (c) { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; } }, true);
  document.addEventListener("mousedown", () => document.getElementById("ov-cur")?.classList.add("down"), true);
  document.addEventListener("mouseup", () => document.getElementById("ov-cur")?.classList.remove("down"), true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
  new MutationObserver(add).observe(document.documentElement, { childList: true });
})();`;

// A scene's name becomes its folder, so it may only be a number and lower-case words.
const SCENE_NAME = /^\d{2}-[a-z]+$/;

async function scene(name, fn, { reduced = false } = {}) {
  if (!SCENE_NAME.test(name)) throw new Error(`Not a scene name: ${name}`);
  const dir = `${OUT}/${name}`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.2, bypassCSP: true, reducedMotion: reduced ? "reduce" : "no-preference" });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(45000);
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const marks = [];
  const caps = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `f${String(n++).padStart(5, "0")}.jpg`;
    fs.writeFileSync(`${dir}/${file}`, Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const mouse = { x: W / 2, y: H / 2 };
  const now = () => Date.now() / 1000;
  const r = {
    page,
    now,
    async start() {
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
      r.t0 = now();
    },
    async tag(text, cls) { await page.evaluate(([t, c]) => window.__tag(t, c), [text, cls]); },
    async cap(html, hold = 0) {
      // Captions mark words only with <b>; the captions file keeps the plain words.
      caps.push({ t: now(), text: html.replaceAll("<b>", "").replaceAll("</b>", "") });
      if (DRAW_CAPTIONS) await page.evaluate((h) => window.__cap(h), html);
      if (hold) await page.waitForTimeout(hold);
    },
    async spot(locator) {
      if (!locator) return page.evaluate(() => window.__spot(null));
      const b = await locator.boundingBox().catch(() => null);
      if (b) await page.evaluate((bb) => window.__spot(bb), b);
    },
    async move(x, y, steps = 25) {
      await page.mouse.move(x, y, { steps });
      mouse.x = x; mouse.y = y;
    },
    async point(locator) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      const b = await locator.boundingBox().catch(() => null);
      if (!b) return;
      await r.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(250);
    },
    async click(locator) {
      await r.point(locator);
      await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
      await page.waitForTimeout(400);
    },
    async type(locator, text) {
      await r.click(locator);
      await locator.pressSequentially(text, { delay: 28 });
    },
    // Run a wait, played back `speed` times faster (0 cuts it out).
    async fast(speed, work) {
      const a = now();
      await work();
      marks.push({ a, b: now(), speed });
    },
    async scroll(dy, ms = 1200) {
      const steps = Math.max(10, Math.round(ms / 16));
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await page.waitForTimeout(ms / steps); }
    },
    wait: (ms) => page.waitForTimeout(ms),
  };
  try {
    await fn(r);
  } finally {
    const end = now();
    await cdp.send("Page.stopScreencast").catch(() => {});
    await page.waitForTimeout(300);
    fs.writeFileSync(`${dir}/rec.json`, JSON.stringify({ t0: r.t0, end, frames, marks, caps }, null, 1));
    await browser.close();
    console.log(`scene ${name}: ${frames.length} frames, ${(end - (r.t0 || end)).toFixed(1)} s raw`);
  }
}

module.exports = { scene, W, H };
