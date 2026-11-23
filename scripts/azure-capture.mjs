import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mediaPattern } from './lib.mjs';

export function azureCaptureContext(env = process.env) {
  const workspace = env.BUILD_SOURCESDIRECTORY;
  const temp = env.AGENT_TEMPDIRECTORY;
  const staging = env.BUILD_ARTIFACTSTAGINGDIRECTORY;
  const runId = env.BUILD_BUILDID;
  const attempt = env.SYSTEM_JOBATTEMPT || '1';
  if (env.BUILD_REASON !== 'PullRequest' || !workspace || !temp || !staging || !/^\d+$/.test(runId || '')) {
    throw new Error('Azure capture requires an Azure Pipelines pull request job.');
  }

  const refNumber = /^refs\/pull\/(\d+)\/merge$/.exec(env.BUILD_SOURCEBRANCH || '')?.[1];
  const number = Number(refNumber || env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER || env.SYSTEM_PULLREQUEST_PULLREQUESTID);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Could not determine the pull request number.');
  const merge = env.BUILD_SOURCEVERSION;
  if (!/^[a-f0-9]{40}$/.test(merge || '')) throw new Error('Could not determine the queued PR merge commit.');

  // Use parents from the queued merge even if either branch has advanced since then.
  const parents = execFileSync('git', ['show', '-s', '--format=%P', merge], { cwd: workspace, encoding: 'utf8' }).trim().split(' ');
  if (parents.length !== 2) throw new Error('Expected a PR merge commit with two parents. Set checkout fetchDepth to 0.');
  const head = env.SYSTEM_PULLREQUEST_SOURCECOMMITID || parents[1];
  if (!parents.includes(head)) throw new Error('The PR source commit does not match the queued merge.');
  const base = head === parents[0] ? parents[1] : parents[0];

  return { workspace, temp, staging, runId, attempt, event: { pull_request: { number, head: { sha: head }, base: { sha: base } } } };
}

export function checkoutAzureHead(workspace, sha) {
  execFileSync('git', ['checkout', '--detach', sha], { cwd: workspace, stdio: 'inherit' });
}

export function stageAzureMedia(out, staging) {
  const files = fs.readdirSync(out, { withFileTypes: true }).filter(file =>
    file.isFile() && /\.(mp4|png)$/.test(file.name) && mediaPattern.test(file.name));
  if (files.length === 0) return;
  const destination = path.join(staging, 'record-prs');
  fs.mkdirSync(destination, { recursive: true });
  for (const { name } of files) fs.copyFileSync(path.join(out, name), path.join(destination, name));
  console.log('##vso[task.setvariable variable=recordPrsHasMedia;isReadOnly=true]true');
}
