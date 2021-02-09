const core = require('@actions/core');
const github = require('@actions/github');

const token = core.getInput('token');
const baseBranch = core.getInput('base');
const requiredApprovalCount = core.getInput('required_approval_count');

const octokit = github.getOctokit(token);
const repo = github.context.repo;

export const log = console.log.bind(null, 'LOG >');
export const outputFailReason = (pullNumber, reason) => log(`Won't update #${pullNumber}, the reason:\n      > ${reason}`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const getOpenPRs = async () => {
  const { data } = await octokit.pulls.list({
    ...repo,
    base: baseBranch,
    state: 'open',
  });

  return data;
}
// use the github api to update a branch
export const updatePRBranch = async (pullNumber) => {
  const { data } = await octokit.pulls.updateBranch({
    ...repo,
    pull_number: pullNumber,
  });

  return data;
};

/**
 * get PR metaData
 */
export const getPR = async (pullNumber) => {
  const { data } = await octokit.pulls.get({
    ...repo,
    pull_number: pullNumber,
  });

  return data;
}

/**
 * get PR mergeable status
 * @param {string} pullNumber
 */
const getMergeableStatus = async (pullNumber) => {
  /**
   * mergeable_state values
   * - behind: The head ref is out of date. // we need to merge base branch into this branch
   * - dirty: The merge commit cannot be cleanly created. // usually means there are conflicts
   * - unknown: The state cannot currently be determined. // need to create a test commit to get the real mergeable_state
   * - and more https://docs.github.com/en/graphql/reference/enums#mergestatestatus
   */
  let data = await getPR(pullNumber);
  let mergeableStatus = {
    mergeable: data.mergeable,
    mergeable_state: data.mergeable_state,
  };

  // for unknown, the first `get` request above will trigger a background job to create a test merge commit
  if (mergeableStatus.mergeable_state === 'unknown') {
    // https://docs.github.com/en/rest/guides/getting-started-with-the-git-database-api#checking-mergeability-of-pull-requests
    // Github recommends to use poll to get a non null/unknown value, we use a compromised version here because of the api rate limit
    await sleep(3000);
    data = await getPR(pullNumber);
    mergeableStatus = {
      mergeable: data.mergeable,
      mergeable_state: data.mergeable_state,
    }
  }

  return mergeableStatus;
}

/**
 * find a applicable PR to update
 */
export const getAutoUpdateCandidate = async (PRs) => {

  // only update `auto merge` enabled PRs
  const autoMergeEnabledPRs = PRs.filter(item => item.auto_merge);
  log('Amount of auto merge enabled PRs:', autoMergeEnabledPRs.length);

  for (const pr of autoMergeEnabledPRs) {
    const { number: pullNumber, head: { sha } } = pr;

    log(`Checking applicable status of #${pullNumber}`);

    // #1 check whether the pr has enough approvals
    const { changesRequestedCount, approvalCount, requiredApprovalCount } = await getApprovalStatus(pullNumber);
    if (changesRequestedCount || approvalCount < requiredApprovalCount) {
      const reason = `approvalsCount: ${approvalCount}, requiredApprovalCount: ${requiredApprovalCount}, changesRequestedReviews: ${changesRequestedCount}`;
      outputFailReason(pullNumber, reason);
      continue;
    };

    /**
     * #2 check whether the PR needs update
     * - the pr is mergeable: no conflicts
     * - the pr is behind the base branch
     */
    const { mergeable, mergeable_state } = await getMergeableStatus(pullNumber);

    if (!mergeable || mergeable_state !== 'behind') {
      let failReason;
      if (!mergeable) {
        failReason = `The 'mergeable' value is: ${mergeable}`;
      }
      if (mergeable_state !== 'behind') {
        failReason = `The 'mergeable_state' value is: "${mergeable_state}". The branch is not "behind" the base branch`;
      }

      outputFailReason(pullNumber, failReason);
      continue;
    };

    /**
     * #3 check whether the pr has failed checks
     * need to note: the mergeable, and mergeable_state don't reflect the checks status
     */
    const didChecksPass =  await areAllChecksPassed(sha);
    if (!didChecksPass) {
      outputFailReason(pullNumber, 'The PR has failed or ongoing check(s)');
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
  const { data: { check_runs } } = await octokit.checks.listForRef({
    ...repo,
    ref: sha,
  })

  const hasUnfinishedOrFailedChecks =  check_runs.some(item => {
    return item.status !== 'completed' || item.conclusion === 'failure';
  });

  return !hasUnfinishedOrFailedChecks;
}

/**
 * check whether PR is mergeable from the Approval perspective
 * the pr needs to have minimum required approvals && no request-for-changes reviews
 */
const getApprovalStatus = async (pullNumber) => {
  const { data: reviewsData} = await octokit.pulls.listReviews({
    ...repo,
    pull_number: pullNumber,
  });

  let changesRequestedCount = 0;
  let approvalCount = 0;

  reviewsData.forEach(({ state }) => {
    if (state === 'CHANGES_REQUESTED') changesRequestedCount += 1;
    if (state === 'APPROVED') approvalCount += 1;
  });

  return {
    changesRequestedCount,
    approvalCount,
    requiredApprovalCount,
  };
}
