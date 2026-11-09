import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installNativeEngine } from '../scripts/capture-engine.mjs';

test('native engine runs Webreel actions and publishes a full-length H.264 video', {
  skip: process.env.CHROME_CAPTURE_SMOKE !== '1', timeout: 120000,
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-prs-native-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const modules = fileURLToPath(new URL('../node_modules', import.meta.url));
  const target = path.join(dir, 'node_modules');
  fs.mkdirSync(target);
  // Isolate the vendor patches; use the lockfile's installed dependencies.
  for (const entry of fs.readdirSync(modules)) {
    if (['@webreel', 'webreel'].includes(entry)) fs.cpSync(path.join(modules, entry), path.join(target, entry), { recursive: true });
    else fs.symlinkSync(path.join(modules, entry), path.join(target, entry));
  }
  installNativeEngine(dir, new URL('../dist/native-recorder.mjs', import.meta.url));
  const page = path.join(dir, 'fixture.html');
  fs.writeFileSync(page, `<!doctype html><style>
    body { font: 16px sans-serif; } button,input { display:block;margin:12px; }
    #from,#to { position:absolute;top:130px;width:40px;height:40px;background:coral; }
    #from { left:20px } #to { left:220px;background:teal; }
    #motion { width:20px;height:20px;background:blue;animation:move 1s linear infinite alternate; }
    @keyframes move { to { transform:translateX(200px) } }
    </style><button onclick="this.id='done';this.textContent='Done';document.getElementById('motion').style.animation='none'">Run</button>
    <input id="field" oninput="this.dataset.value=this.value"><div id="from"></div><div id="to" ondrop="document.body.dataset.dragged='true'"></div><div id="motion"></div>`);
  const output = path.join(dir, 'journey.mp4');
  const screenshot = path.join(dir, 'after.png');
  const config = path.join(dir, 'webreel.config.json');
  fs.writeFileSync(config, JSON.stringify({
    viewport: { width: 320, height: 240 },
    theme: { hud: { fontSize: 16 } },
    videos: { journey: {
      url: pathToFileURL(page).href, output, thumbnail: { enabled: false },
      steps: [
        { action: 'key', target: '#field', key: 'ArrowRight' },
        { action: 'type', text: 'Native video' },
        { action: 'wait', selector: '#field[data-value="Native video"]', timeout: 5000 },
        { action: 'click', selector: 'button' },
        { action: 'wait', selector: '#done', timeout: 5000 },
        { action: 'drag', from: { selector: '#from' }, to: { selector: '#to' } },
        { action: 'wait', selector: 'body[data-dragged="true"]', timeout: 5000 },
        { action: 'pause', ms: 1200 },
        { action: 'screenshot', output: screenshot },
      ],
    } },
  }));
  const recorded = spawnSync(process.execPath, [path.join(target, 'webreel', 'dist', 'index.js'), 'record', '-c', config], {
    env: { ...process.env, FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg' },
    encoding: 'utf8', timeout: 90000,
  });
  assert.equal(recorded.status, 0, `${recorded.error || ''}\n${recorded.stdout}\n${recorded.stderr}`);
  assert.deepEqual(fs.readFileSync(screenshot).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const { streams, format } = JSON.parse(probe.stdout);
  assert.equal(streams[0].codec_name, 'h264');
  assert.equal(streams[0].width, 320);
  assert.equal(streams[0].height, 240);
  assert.equal(streams[0].r_frame_rate, '60/1');
  const timeline = JSON.parse(fs.readFileSync(path.join(dir, '.webreel', 'timelines', 'journey.timeline.json')));
  assert.ok(Math.abs(Number(format.duration) - timeline.frames.length / timeline.fps) < 0.1, 'Video preserves the complete interaction timeline');
  assert.ok(Number(format.duration) > 3);
  assert.ok(Number(format.size) < 10 * 1024 * 1024, 'Video fits the publisher size limit');
});
