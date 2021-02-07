const core = require('@actions/core');
const github = require('@actions/github');

const octokit = github.getOctokit(core.getInput('token'));
const baseBranch = core.getInput('base');
const requiredApprovalCount = core.getInput('required_approval_count');
const repo = github.context.repo;

const log = console.log.bind(null, '=== ACTION LOG ===:');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// use the github api to update a branch
const updatePR = (pullNumber) => {
  return octokit.pulls.updateBranch({
    ...repo,
    pull_number: pullNumber,
  });
};

const getMergeableInfo = async (pullNumber) => {
  const { data: { mergeable, mergeable_state } } = await octokit.pulls.get({
    ...repo,
    pull_number: pullNumber,
  });

  return { mergeable, mergeable_state };
}

const getMergeableStatus = async (pullNumber) => {
  /**
   * mergeable_state values
   * - behind: The head ref is out of date. // we need to merge base branch into this branch
   * - dirty: The merge commit cannot be cleanly created. // usually means there are conflicts
   * - unknown: The state cannot currently be determined. // need to create a test commit to get the real mergeable_state
   * - and more https://docs.github.com/en/graphql/reference/enums#mergestatestatus
   */
  let mergeableStatus = await getMergeableInfo(pullNumber);

  // for unknown, the first `get` request above will trigger a background job to create a test merge commit
  if (mergeableStatus.mergeable_state === 'unknown') {
    // https://docs.github.com/en/rest/guides/getting-started-with-the-git-database-api#checking-mergeability-of-pull-requests
    // Github recommends to use poll to get a non null/unknown value, we use a compromised version here because of the api rate limit
    await sleep(3000);
    mergeableStatus = await getMergeableInfo(pullNumber);
  }

  return mergeableStatus;
}

/**
 * find a applicable PR to update
 */
const getAutoUpdateCandidate = async (PRs) => {

  // only update `auto merge` enabled PRs
  const autoMergeEnabledPRs = PRs.filter(item => item.auto_merge);
  log('Amount of auto merge enabled PRs:', autoMergeEnabledPRs.length);

  for (pr of autoMergeEnabledPRs) {
    const { number: pullNumber, head: { sha } } = pr;

    log('Checking applicable status of #:', pullNumber)

    // #1 check whether the pr has enough approvals
    const approvalStatus = await hasEnoughApprovals(pullNumber);
    if (!approvalStatus) continue;

    /**
     * #2 check whether the PR needs update
     * - the pr is mergeable: no conflicts
     * - the pr is behind the base branch 
     */
    const { mergeable, mergeable_state } = await getMergeableStatus(pullNumber);
    if (!mergeable || mergeable_state !== 'behind') {
      log(`#${pullNumber} doesn't need update. { mergeable: ${mergeable}, mergeable_state: ${mergeable_state}}`);
      continue;
    };

    /**
     * #3 check whether the pr has failed checks
     * need to note: the mergeable, and mergeable_state don't reflect the checks status
     */
    const didChecksPass =  await areAllChecksPassed(sha);
    if (!didChecksPass) {
      log(`#${pullNumber} has failed or ongoing check(s)`);
      continue;
    };

    return pr;
  }

  return null;
};

/**
 * whether all checks passed 
 */
const areAllChecksPassed = async (sha) => {
  const result = await octokit.checks.listForRef({
    ...repo,
    ref: sha,
  })

  const hasUnfinishedOrFailedChecks =  result.data.check_runs.some(item => {
    return item.status !== 'completed' || item.conclusion === 'failure';
  });

  return !hasUnfinishedOrFailedChecks;
}

/**
 * check whether PR is mergeable from the Approval perspective
 * the pr needs to have minimum required approvals && no request-for-changes reviews
 */
const hasEnoughApprovals = async (pullNumber) => {
  const { data: reviewsData} = await octokit.pulls.listReviews({
    ...repo,
    pull_number: pullNumber,
  });

  let hasChangesRequested = false;
  let approvalAmount = 0;

  reviewsData.forEach(({ state }) => {
    if (state === 'CHANGES_REQUESTED') hasChangesRequested = true;
    if (state === 'APPROVED') approvalAmount += 1;
  });

  const isMergeable = !hasChangesRequested && approvalAmount >= requiredApprovalCount;
  if (!isMergeable) {
    log(`#${pullNumber} approval status: approvals: ${approvalAmount}, changesRequested: ${hasChangesRequested}`);
  }

  return isMergeable;
}

async function main() {
  try {
    const pullsResponse = await octokit.pulls.list({
      ...repo,
      base: baseBranch,
      state: 'open',
    });

    const pr = await getAutoUpdateCandidate(pullsResponse.data);
    if (!pr) {
      log('No applicable PR to update.');
      return;
    }

    // update the pr
    log(`Trying to update PR branch: #${pr.number}`);

    // TODO (zhiye): try next the PR in the queue if update fails
    await updatePR(pr.number);
  } catch (err) {
    core.setFailed(`Action failed with error ${err}`);
  }
}

main();
