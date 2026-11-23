import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as core from '@actions/core';
import { identity, prefix, selectJourneys } from './lib.mjs';
import { patchChromeSource } from './webreel-compat.mjs';
import { expandJourneySteps, selectPullRequestJourneys } from './journeys.mjs';
import { captureEngine, installNativeEngine } from './capture-engine.mjs';
import { azureCaptureContext, checkoutAzureHead, stageAzureMedia } from './azure-capture.mjs';
import { fileURLToPath } from 'node:url';

const get = (name, fallback = '') => process.env[`INPUT_${name.toUpperCase().replaceAll('-', '_')}`] || fallback;
const azure = process.argv.includes('--azure-pipelines') ? azureCaptureContext() : undefined;
const workspace = azure?.workspace || process.env.GITHUB_WORKSPACE || process.cwd();
const temp = azure?.temp || process.env.RUNNER_TEMP;
const runId = azure?.runId || process.env.GITHUB_RUN_ID || 'local';
const attempt = azure?.attempt || process.env.GITHUB_RUN_ATTEMPT || '1';
const root = path.resolve(workspace, get('working-directory', '.'));
const event = azure?.event || JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const id = identity(event, attempt);
const baseSha = event.pull_request.base.sha;
const out = path.join(temp || workspace, 'record-prs', runId, String(id.attempt));
fs.mkdirSync(out, { recursive: true });
if (!azure) core.setOutput('media-directory', out);
const state = { ...id, skipped: false, journeys: [], success: false };
const markerPath = path.join(out, `${prefix(id)}-marker.json`);
const writeMarker = () => fs.writeFileSync(markerPath, JSON.stringify(state));
writeMarker();

function command(command, args, cwd = root, env = process.env, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached:true });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      reject(new Error(`${command} exceeded its ${Math.round(timeoutMs / 1000)} second timeout.`));
    }, timeoutMs);
    child.on('error', error => {clearTimeout(timer); reject(error)});
    child.on('exit', code => {clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))});
  });
}
const shell = text => command('bash', ['-eo', 'pipefail', '-c', text]);
let server;
let log;
try {
  if (azure) checkoutAzureHead(workspace, id.sha);
  const engine = captureEngine(get('capture-engine', 'webreel'));
  const configPath = path.resolve(root, get('config', 'webreel.config.json'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.videos || typeof config.videos !== 'object' || Array.isArray(config.videos)) throw new Error('Webreel config must define a videos object.');
  const mapPath = get('journey-map');
  let selected;
  if (mapPath) {
    const mapping = JSON.parse(fs.readFileSync(path.resolve(root, mapPath), 'utf8'));
    const diff = spawnSync('git', ['diff', '--name-only', '-z', `${baseSha}...${id.sha}`], {cwd: workspace, encoding:'utf8'});
    if (diff.status !== 0) throw new Error('Could not read the PR diff. Use fetch-depth: 0.');
    selected = selectJourneys(config.videos, mapping, diff.stdout.split('\0').filter(Boolean));
  } else {
    selected = selectPullRequestJourneys(config, configPath, workspace, baseSha, id.sha);
  }
  state.journeys = selected;
  if (!selected.length) {
    state.skipped = true;
    state.success = true;
    const notice = azure ? console.info : core.notice;
    notice('No journeys selected for this PR.');
  } else {
    if (selected.length > 8) throw new Error('At most 8 journeys can be recorded per run.');
    await shell(get('install-command', azure ? 'bun install --frozen-lockfile' : 'npm ci'));
    const native = engine === 'chrome-capture';
    if (native) {
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (major < 24 || (major === 24 && minor < 11)) throw new Error('chrome-capture requires Node 24.11+.');
    }
    const toolDir = path.join(azure ? out : temp || out, `record-prs-webreel-0.1.4${native ? '-chrome-capture-0.1.2' : ''}`);
    const packages = ['webreel@0.1.4', ...(native ? ['chrome-capture@0.1.2'] : [])];
    if (azure) {
      fs.mkdirSync(toolDir, { recursive: true });
      await command('bun', ['add', '--exact', '--linker', 'hoisted', ...packages], toolDir);
    } else {
      await command('npm', ['install', '--prefix', toolDir, '--no-audit', '--no-fund', ...packages], workspace);
    }
    if (native) {
      installNativeEngine(toolDir, fileURLToPath(new URL('./native-recorder.mjs', import.meta.url)));
      core.info('Recording with chrome-capture 0.1.2 and Webreel overlays (Chrome 153+ required).');
    } else if (process.platform === 'linux') {
      const chromeSource = path.join(toolDir, 'node_modules', '@webreel', 'core', 'dist', 'chrome.js');
      fs.writeFileSync(chromeSource, patchChromeSource(fs.readFileSync(chromeSource, 'utf8')));
      core.info('Applied the Webreel 0.1.4 Linux frame-control compatibility fix.');
    }
    const cli = path.join(toolDir, 'node_modules', '.bin', 'webreel');
    // Webreel 0.1.4 downloads Chrome and FFmpeg on first record; its CLI has no install subcommand.
    const baseUrl = get('base-url', 'http://127.0.0.1:3000');
    const env = { ...process.env, FEATURE_DEMO_BASE_URL: baseUrl, RECORD_PRS_BASE_URL: baseUrl };
    const start = get('start-command');
    if (start) {
      log = fs.openSync(path.join(out, 'app.log'), 'w');
      server = spawn('bash', ['-eo', 'pipefail', '-c', start], {cwd: root, env, detached:true, stdio:['ignore',log,log]});
      const warn = azure ? console.warn : core.warning;
      server.on('error', error => warn(error.message));
    }
    const deadline = Date.now() + Number(get('ready-timeout', '90')) * 1000;
    let ready = false;
    while (Date.now() < deadline) {
      if (server && server.exitCode !== null) throw new Error('Application exited before becoming ready.');
      try { const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) }); ready = response.ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error(`Application was not ready at ${baseUrl}.`);
    const prepared = { ...config, baseUrl, outDir: out, videos: {} };
    let screenshot = 0;
    delete prepared.include;
    for (const name of selected) {
      const video = config.videos[name];
      const steps = expandJourneySteps(config, video, configPath).map(step => step.action === 'screenshot' ? {...step, output: path.join(out, `${prefix(id)}-${String(++screenshot).padStart(2,'0')}-screenshot.png`)} : step);
      prepared.videos[name] = { ...video, baseUrl, output: `${prefix(id)}-${name}.mp4`, thumbnail: {enabled:false}, steps };
      delete prepared.videos[name].include;
    }
    const generated = path.join(out, 'webreel.config.json');
    fs.writeFileSync(generated, JSON.stringify(prepared));
    await command(cli, ['validate', '-c', generated], root, env);
    await command(cli, ['record', '--verbose', '-c', generated], root, env, 300000);
    for (const name of selected) {
      if (!fs.existsSync(path.join(out, `${prefix(id)}-${name}.mp4`))) throw new Error(`Journey ${name} produced no video.`);
    }
    if (azure) stageAzureMedia(out, azure.staging);
    state.success = true;
  }
} catch (error) {
  if (azure) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    core.setFailed(error.message);
  }
  if (fs.existsSync(path.join(out, 'app.log'))) core.info(fs.readFileSync(path.join(out, 'app.log'), 'utf8').slice(-16000));
} finally {
  writeMarker();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  if (log !== undefined) fs.closeSync(log);
}
