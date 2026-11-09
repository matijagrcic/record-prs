import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function captureEngine(value = 'webreel') {
  if (!['webreel', 'chrome-capture'].includes(value)) {
    throw new Error(`Unknown capture-engine: ${value}. Choose webreel or chrome-capture.`);
  }
  return value;
}

// Webreel 0.1.4 exposes its engine through these two re-exports. Replace only
// those bindings so configuration, actions, screenshots and compositing keep
// running upstream code. Refuse unexpected source rather than partly patching.
export function patchNativeExports(source) {
  const replacements = [
    ['export { launchChrome } from "./chrome.js";', 'export { launchChrome } from "./record-prs-native.mjs";'],
    ['export { Recorder } from "./recorder.js";', 'export { Recorder } from "./record-prs-native.mjs";'],
  ];
  if (replacements.every(([, after]) => source.split(after).length === 2) && replacements.every(([before]) => !source.includes(before))) return source;
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Unexpected Webreel 0.1.4 engine exports; chrome-capture patch refused.');
    source = source.replace(before, after);
  }
  return source;
}

export function patchNativeCompositor(source) {
  const before = '"[0][1]overlay=0:0:shortest=1"';
  // Chrome emits variable-rate video and can omit the final static hold. Match
  // the timeline's frame cadence and extend that last image through its end.
  const after = '`[0:v]fps=${fps},tpad=stop_mode=clone:stop_duration=${timeline.frames.length / fps},trim=duration=${timeline.frames.length / fps}[native];[native][1]overlay=0:0:shortest=1`';
  if (source.split(after).length === 2 && !source.includes(before)) return source;
  if (source.split(before).length !== 2) throw new Error('Unexpected Webreel 0.1.4 compositor; chrome-capture patch refused.');
  return source.replace(before, after);
}

export function installNativeEngine(toolDir, adapterPath) {
  const coreDir = path.join(toolDir, 'node_modules', '@webreel', 'core', 'dist');
  const index = path.join(coreDir, 'index.js');
  const patched = patchNativeExports(fs.readFileSync(index, 'utf8'));
  const compositor = path.join(coreDir, 'compositor.js');
  const patchedCompositor = patchNativeCompositor(fs.readFileSync(compositor, 'utf8'));
  // Resolve chrome-capture from the tool installation, independent of the
  // action checkout and of the caller application's node_modules.
  const adapter = path.join(toolDir, 'record-prs-native.mjs');
  fs.copyFileSync(adapterPath, adapter);
  fs.writeFileSync(path.join(coreDir, 'record-prs-native.mjs'), `export { Recorder, launchChrome } from ${JSON.stringify(pathToFileURL(adapter).href)};\n`);
  fs.writeFileSync(index, patched);
  fs.writeFileSync(compositor, patchedCompositor);
}
