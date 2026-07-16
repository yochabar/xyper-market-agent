#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { apiGet, apiPost } from './lib/api.mjs';
import { cookiesPath, resolveStateDir } from './lib/state.mjs';
import { getRuntime } from './lib/runtime.mjs';
import { normalizeTxRequest, requireGas, sendTransaction } from './lib/evm.mjs';
import { createLoggedInScraper, publishTweet } from './lib/x_session.mjs';

const [command = 'monitor', ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    'state-dir': { type: 'string', default: '' },
    'campaign-id': { type: 'string', default: '' },
    'submission-id': { type: 'string', default: '' },
    text: { type: 'string', default: '' },
    'allow-post': { type: 'boolean', default: false },
    'allow-onchain': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false }
  },
  strict: true
});

const stateDir = resolveStateDir(values['state-dir']);

function output(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function listFrom(payload) {
  return Array.isArray(payload) ? payload : payload?.results || [];
}

function campaignChainId(campaign) {
  return Number(campaign?.chainId ?? campaign?.chain_id ?? campaign?.chain?.chainId ?? 0);
}

function requireFlag(name, message) {
  if (!values[name]) throw new Error(message);
}

function transactionUrl(config, hash) {
  return `${config.network.explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
}

async function scan(runtime) {
  const [campaignData, submissionData] = await Promise.all([
    apiGet(
      runtime.config,
      `/api/agent/v1/campaigns/?status=live&joined=false&chainId=${runtime.config.network.chainId}`,
      runtime.token
    ),
    apiGet(
      runtime.config,
      '/api/agent/v1/me/submissions/?status=submitted,validating,approved,claimable',
      runtime.token
    )
  ]);
  const campaigns = listFrom(campaignData);
  const submissions = listFrom(submissionData);
  const claimable = submissions.filter((item) => item.status === 'claimable');
  const pending = submissions.filter((item) => item.status !== 'claimable');
  return {
    status: 'ok',
    checkedAt: new Date().toISOString(),
    activeCampaigns: campaigns,
    claimableSubmissions: claimable,
    pendingSubmissions: pending,
    nextActions: [
      ...campaigns.map((item) => ({ type: 'review_campaign', campaignId: item.id, title: item.title })),
      ...claimable.map((item) => ({ type: 'claim_reward', submissionId: item.id }))
    ]
  };
}

async function approveSubmission(runtime, submissionId) {
  await requireGas(runtime.config, runtime.account);
  const intent = await apiPost(
    runtime.config,
    `/api/agent/v1/submissions/${submissionId}/onchain-intent/`,
    {},
    runtime.token
  );
  const txRequest = normalizeTxRequest(runtime.config, intent);
  const approvalTxHash = await sendTransaction(runtime.config, runtime.account, txRequest);
  await apiPost(
    runtime.config,
    `/api/agent/v1/submissions/${submissionId}/onchain-confirm/`,
    { approvalTxHash },
    runtime.token
  );
  return {
    submissionId,
    approvalTxHash,
    approvalExplorerUrl: transactionUrl(runtime.config, approvalTxHash),
    status: 'approved_onchain'
  };
}

async function claimSubmission(runtime, submissionId) {
  await requireGas(runtime.config, runtime.account);
  const intent = await apiPost(
    runtime.config,
    `/api/agent/v1/submissions/${submissionId}/claim-intent/`,
    {},
    runtime.token
  );
  const txRequest = normalizeTxRequest(runtime.config, intent);
  const claimTxHash = await sendTransaction(runtime.config, runtime.account, txRequest);
  await apiPost(
    runtime.config,
    `/api/agent/v1/submissions/${submissionId}/claim-confirm/`,
    { claimTxHash },
    runtime.token
  );
  return {
    submissionId,
    claimTxHash,
    claimExplorerUrl: transactionUrl(runtime.config, claimTxHash),
    status: 'claimed'
  };
}

async function run() {
  if (values['dry-run']) {
    if (command === 'scan' || command === 'monitor') {
      output({
        status: 'ok',
        dryRun: true,
        activeCampaigns: [{ id: 'campaign-dry-run', title: 'Example campaign', status: 'live' }],
        claimableSubmissions: [{ id: 'submission-dry-run', status: 'claimable' }],
        pendingSubmissions: []
      });
      return;
    }
    output({
      status: 'dry_run',
      command,
      campaignId: values['campaign-id'] || null,
      submissionId: values['submission-id'] || null,
      text: values.text || null,
      wouldPost: command === 'publish',
      wouldSendTransaction: ['publish', 'approve', 'claim', 'claim-all'].includes(command)
    });
    return;
  }

  const runtime = await getRuntime(stateDir);

  if (command === 'scan' || command === 'monitor') {
    output(await scan(runtime));
    return;
  }

  if (command === 'show') {
    requireFlag('campaign-id', '--campaign-id required');
    output(await apiGet(
      runtime.config,
      `/api/agent/v1/campaigns/${values['campaign-id']}/`,
      runtime.token
    ));
    return;
  }

  if (command === 'join') {
    requireFlag('campaign-id', '--campaign-id required');
    output(await apiPost(
      runtime.config,
      `/api/agent/v1/campaigns/${values['campaign-id']}/join/`,
      {},
      runtime.token
    ));
    return;
  }

  if (command === 'publish') {
    requireFlag('campaign-id', '--campaign-id required');
    requireFlag('text', '--text required');
    requireFlag('allow-post', '--allow-post required');
    requireFlag('allow-onchain', '--allow-onchain required because approval is mandatory');
    if (values.text.length > 280) throw new Error(`tweet_too_long:${values.text.length}`);

    const campaign = await apiGet(
      runtime.config,
      `/api/agent/v1/campaigns/${values['campaign-id']}/`,
      runtime.token
    );
    const chainId = campaignChainId(campaign);
    if (chainId && chainId !== runtime.config.network.chainId) {
      throw new Error(`unsupported_campaign_chain:${chainId}`);
    }
    await requireGas(runtime.config, runtime.account);
    const scraper = await createLoggedInScraper(cookiesPath(stateDir));
    const tweet = await publishTweet(scraper, values.text, cookiesPath(stateDir));
    const submission = await apiPost(
      runtime.config,
      `/api/agent/v1/campaigns/${values['campaign-id']}/submissions/`,
      {
        walletAddress: runtime.wallet.address,
        platform: 'x',
        postUrl: tweet.tweetUrl,
        externalPostId: tweet.tweetId,
        contentText: values.text,
        postedAt: tweet.postedAt,
        source: 'agent'
      },
      runtime.token
    );
    const submissionId = submission.submissionId || submission.id;
    if (!submissionId) throw new Error('submission_id_missing');
    const approval = await approveSubmission(runtime, submissionId);
    output({
      status: 'submitted_and_approved',
      campaignId: values['campaign-id'],
      tweet,
      submissionId,
      approvalTxHash: approval.approvalTxHash,
      approvalExplorerUrl: approval.approvalExplorerUrl
    });
    return;
  }

  if (command === 'approve') {
    requireFlag('submission-id', '--submission-id required');
    requireFlag('allow-onchain', '--allow-onchain required');
    output(await approveSubmission(runtime, values['submission-id']));
    return;
  }

  if (command === 'claim') {
    requireFlag('submission-id', '--submission-id required');
    requireFlag('allow-onchain', '--allow-onchain required');
    output(await claimSubmission(runtime, values['submission-id']));
    return;
  }

  if (command === 'claim-all') {
    requireFlag('allow-onchain', '--allow-onchain required');
    const snapshot = await scan(runtime);
    const claims = [];
    for (const submission of snapshot.claimableSubmissions) {
      claims.push(await claimSubmission(runtime, submission.id));
    }
    output({ status: 'claimed_all', count: claims.length, claims });
    return;
  }

  throw new Error(`unknown_command:${command}`);
}

try {
  await run();
} catch (error) {
  console.error(JSON.stringify({
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
    command,
    stateDir
  }, null, 2));
  process.exitCode = 1;
}
