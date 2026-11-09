// scripts/native-recorder.mjs
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CdpScreenRecorder, launchChrome as launchNativeChrome } from "chrome-capture";
var TimelineClock = class {
  constructor(timeline, fps, now = () => performance.now()) {
    this.timeline = timeline;
    this.fps = fps;
    this.now = now;
    this.frames = 0;
  }
  start() {
    this.started = this.now();
    this.advance();
    this.timer = setInterval(() => this.advance(), 1e3 / this.fps);
  }
  advance() {
    const frames = Math.floor((this.now() - this.started) * this.fps / 1e3) + 1;
    while (this.frames < frames) {
      this.timeline.tick();
      this.frames++;
    }
  }
  stop() {
    clearInterval(this.timer);
    this.advance();
  }
};
var Recorder = class {
  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    this.fps = options.fps ?? 60;
    if (!Number.isFinite(this.fps) || this.fps < 1 || this.fps > 60) {
      throw new Error("chrome-capture supports 1\u201360 fps in this headless recording pipeline.");
    }
    if (options.framesDir) throw new Error("Raw JPEG frame export requires capture-engine: webreel.");
  }
  setTimeline(timeline) {
    this.timeline = timeline;
  }
  getTempVideoPath() {
    return this.tempVideo;
  }
  // Webreel records sound events directly on its interaction timeline.
  addEvent() {
  }
  async start(client, outputPath, ctx) {
    if (!this.timeline) throw new Error("chrome-capture requires a Webreel interaction timeline.");
    const { product } = await client.Browser.getVersion();
    const major = Number(product.match(/\/(\d+)/)?.[1]);
    if (!major || major < 153) {
      throw new Error(`chrome-capture requires Chrome 153+; found ${product}. Set CHROME_PATH to a supported Chrome binary or use capture-engine: webreel.`);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    this.tempVideo = path.join(path.dirname(outputPath), `.native-${randomUUID()}.mp4`);
    this.recorder = new CdpScreenRecorder(client);
    await this.recorder.start({ frameRate: this.fps, maxWidth: this.width, maxHeight: this.height, captureArea: "target", audio: false });
    this.ctx = ctx;
    ctx?.setRecorder(this);
    this.clock = new TimelineClock(this.timeline, this.fps);
    this.clock.start();
  }
  stop() {
    this.stopping ??= this.finish();
    return this.stopping;
  }
  async finish() {
    if (!this.clock) return;
    this.clock?.stop();
    this.ctx?.setRecorder(null);
    const bytes = await this.recorder.stop();
    if (!bytes.length) throw new Error("chrome-capture produced an empty recording.");
    fs.writeFileSync(this.tempVideo, bytes);
  }
};
async function launchChrome() {
  const chrome = await launchNativeChrome({ headless: true });
  return {
    process: chrome.proc,
    port: Number(new URL(chrome.browserWsUrl).port),
    kill: () => {
      void chrome.close().catch((error) => console.warn("Failed to close Chrome:", error));
    }
  };
}
export {
  Recorder,
  TimelineClock,
  launchChrome
};
