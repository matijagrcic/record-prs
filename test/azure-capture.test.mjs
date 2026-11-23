import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { azureCaptureContext, stageAzureMedia } from '../scripts/azure-capture.mjs';

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'record-prs-azure-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const workspace = path.join(temp, 'source');
  fs.mkdirSync(workspace);
  const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'target');
  git('config', 'user.name', 'Recording Test');
  git('config', 'user.email', 'recording@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const config = path.join(workspace, 'webreel.config.json');
  fs.writeFileSync(config, '{"videos":{}}');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Target branch');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'feature');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'App-only change', '--allow-empty');
  const head = git('rev-parse', 'HEAD');
  fs.writeFileSync(config, '{"videos":{"target-only":{"steps":[]}}}');
  git('add', '.');
  const mergeTree = git('write-tree');
  const merge = git('commit-tree', mergeTree, '-p', base, '-p', head, '-m', 'Queued PR merge');
  git('checkout', '--force', '--detach', merge);
  const env = {
    BUILD_REASON: 'PullRequest', BUILD_SOURCESDIRECTORY: workspace, AGENT_TEMPDIRECTORY: temp,
    BUILD_ARTIFACTSTAGINGDIRECTORY: path.join(temp, 'artifacts'), BUILD_BUILDID: '314', SYSTEM_JOBATTEMPT: '2',
    BUILD_SOURCEBRANCH: 'refs/pull/42/merge', BUILD_SOURCEVERSION: merge,
  };
  return { git, env, head, base, temp, mergeTree };
}

test('Azure capture checks out the exact source before selecting journeys and skips empty media', t => {
  const { git, env, head, temp } = fixture(t);
  const capture = fileURLToPath(new URL('../scripts/capture.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [capture, '--azure-pipelines'], {
    encoding: 'utf8', env: { ...env, INPUT_INSTALL_COMMAND: 'exit 97', INPUT_START_COMMAND: 'exit 98' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.match(result.stdout, /No journeys selected/);
  const marker = path.join(temp, 'record-prs/314/2', `record-prs-pr-42-${head}-attempt-2-marker.json`);
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), { number: 42, sha: head, attempt: 2, skipped: true, journeys: [], success: true });
  assert.equal(fs.existsSync(env.BUILD_ARTIFACTSTAGINGDIRECTORY), false);
});

test('Azure Repos source metadata identifies the source even when it is the first parent', t => {
  const { git, env, head, base, mergeTree } = fixture(t);
  env.BUILD_SOURCEVERSION = git('commit-tree', mergeTree, '-p', head, '-p', base, '-m', 'Queued PR merge');
  env.BUILD_SOURCEBRANCH = 'refs/heads/feature';
  env.SYSTEM_PULLREQUEST_PULLREQUESTID = '37';
  env.SYSTEM_PULLREQUEST_SOURCECOMMITID = head;
  assert.deepEqual(azureCaptureContext(env).event.pull_request, { number: 37, head: { sha: head }, base: { sha: base } });
  env.SYSTEM_PULLREQUEST_SOURCECOMMITID = 'a'.repeat(40);
  assert.throws(() => azureCaptureContext(env), /does not match the queued merge/);
});

test('Azure artifact staging copies only regular recording files', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'record-prs-azure-media-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const prefix = `record-prs-pr-42-${'a'.repeat(40)}-attempt-1`;
  const media = [`${prefix}-01-screenshot.png`, `${prefix}-navigation.mp4`];
  for (const name of [...media, `${prefix}-marker.json`, 'app.log', 'unrelated.png']) {
    fs.writeFileSync(path.join(temp, name), name);
  }
  fs.symlinkSync(media[0], path.join(temp, `${prefix}-linked.png`));
  const destination = path.join(temp, 'artifacts');
  stageAzureMedia(temp, destination);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'record-prs')).sort(), media);
});
