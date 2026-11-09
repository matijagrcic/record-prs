import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureEngine, installNativeEngine, patchNativeExports, patchNativeCompositor } from '../scripts/capture-engine.mjs';
import { Recorder, TimelineClock } from '../scripts/native-recorder.mjs';

const exports = fs.readFileSync(new URL('../node_modules/@webreel/core/dist/index.js', import.meta.url), 'utf8');
const compositor = fs.readFileSync(new URL('../node_modules/@webreel/core/dist/compositor.js', import.meta.url), 'utf8');

test('engine selection defaults to Webreel and rejects typos', () => {
  assert.equal(captureEngine(), 'webreel');
  assert.equal(captureEngine('chrome-capture'), 'chrome-capture');
  assert.throws(() => captureEngine('chrome'), /Unknown capture-engine/);
});

test('native adapter replaces only the pinned recorder and browser exports', () => {
  const patched = patchNativeExports(exports);
  assert.equal(patchNativeExports(patched), patched);
  assert.equal(patched.replaceAll('./record-prs-native.mjs', './REPLACED'), exports.replace('./chrome.js', './REPLACED').replace('./recorder.js', './REPLACED'));
  assert.throws(() => patchNativeExports(exports.replace('export { Recorder }', 'export { OtherRecorder }')), /patch refused/);
  assert.throws(() => patchNativeExports(exports.replace('./chrome.js', './record-prs-native.mjs')), /patch refused/);
});

test('installation resolves the adapter inside the tool directory and survives reruns', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-prs-engine-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const coreDir = path.join(dir, 'node_modules', '@webreel', 'core', 'dist');
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(path.join(coreDir, 'index.js'), exports);
  fs.writeFileSync(path.join(coreDir, 'compositor.js'), compositor);
  const adapter = new URL('../scripts/native-recorder.mjs', import.meta.url);
  installNativeEngine(dir, adapter);
  installNativeEngine(dir, adapter);
  assert.match(fs.readFileSync(path.join(coreDir, 'record-prs-native.mjs'), 'utf8'), /file:.*record-prs-native.mjs/);
  assert.equal(fs.readFileSync(path.join(dir, 'record-prs-native.mjs'), 'utf8'), fs.readFileSync(adapter, 'utf8'));
});

test('native compositor holds static frames through the full interaction timeline', () => {
  const patched = patchNativeCompositor(compositor);
  assert.match(patched, /fps=\$\{fps\},tpad=stop_mode=clone/);
  assert.match(patched, /trim=duration=\$\{timeline.frames.length \/ fps\}/);
  assert.equal(patchNativeCompositor(patched), patched);
  assert.throws(() => patchNativeCompositor('changed upstream filter'), /patch refused/);
});

test('timeline catches up to elapsed video time after delayed callbacks', () => {
  let now = 0;
  let ticks = 0;
  const clock = new TimelineClock({ tick() { ticks++; } }, 60, () => now);
  clock.started = now;
  clock.advance();
  assert.equal(ticks, 1);
  now = 1000;
  clock.advance();
  assert.equal(ticks, 61);
  clock.advance();
  assert.equal(ticks, 61);
});

test('unsupported Chrome fails before starting recording', async () => {
  const recorder = new Recorder(1280, 720);
  recorder.setTimeline({ tick() {} });
  await assert.rejects(recorder.start({ Browser: { getVersion: async () => ({ product: 'Chrome/152.0.0.0' }) } }, '/unused.mp4'), /requires Chrome 153/);
  assert.throws(() => new Recorder(1280, 720, { fps: 120 }), /1–60 fps/);
});

test('native recorder drains its stream once and closes it when reading fails', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-prs-native-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const fails of [false, true]) {
    const calls = [];
    const bytes = Buffer.from('0000ftypisom0000');
    const client = {
      Browser: { getVersion: async () => ({ product: 'Chrome/156.0.0.0' }) },
      async send(method, params) {
        calls.push(method);
        if (method === 'Page.startScreenRecording') {
          assert.equal(params.audio, false);
          return { stream: 'video' };
        }
        if (method === 'Page.stopScreenRecording') return { stream: 'video' };
        if (method === 'IO.read') {
          if (fails) throw new Error('stream failed');
          return { data: bytes.toString('base64'), base64Encoded: true, eof: true };
        }
      },
    };
    let context;
    const recorder = new Recorder(1280, 720);
    recorder.setTimeline({ tick() {} });
    await recorder.start(client, path.join(dir, 'flow.mp4'), { setRecorder(value) { context = value; } });
    assert.equal(context, recorder);
    if (fails) {
      await assert.rejects(recorder.stop(), /stream failed/);
      await assert.rejects(recorder.stop(), /stream failed/);
    } else {
      await Promise.all([recorder.stop(), recorder.stop()]);
      assert.deepEqual(fs.readFileSync(recorder.getTempVideoPath()), bytes);
    }
    assert.equal(context, null);
    assert.equal(calls.filter(method => method === 'Page.stopScreenRecording').length, 1);
    assert.equal(calls.at(-1), 'IO.close');
  }
});
