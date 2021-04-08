const core = require('@actions/core');
const github = require('@actions/github');
const { log, printFailReason, wait } = require('./util');

const getOctokit = () => {
  const token = core.getInput('token');
  return github.getOctokit(token);
};

export const getOpenPRs = async () => {
  const octokit = getOctokit();
  const repo = github.context.repo;
  const baseBranch = core.getInput('base');

  const { data } = await octokit.pulls.list({
    ...repo,
    base: baseBranch,
    state: 'open',
  });

  return data;
};

// use the github api to update a branch
export const updatePRBranch = async (pullNumber) => {
  const octokit = getOctokit();
  const repo = github.context.repo;
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
  const octokit = getOctokit();
  const repo = github.context.repo;
  const result = await octokit.pulls.get({
    ...repo,
    pull_number: pullNumber,
  });

  return result.data;
};

/**
 * get PR mergeable status
 * @param {string} pullNumber
 */
export const getMergeableStatus = async (pullNumber) => {
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
    console.info(mergeableStatus, wait);
    await wait(3000);
    data = await getPR(pullNumber);
    mergeableStatus = {
      mergeable: data.mergeable,
      mergeable_state: data.mergeable_state,
    };
  }

  return mergeableStatus;
};

/**
 * whether all checks passed
 */
export const areAllChecksPassed = async (sha) => {
  const octokit = getOctokit();
  const repo = github.context.repo;
  const {
    data: { check_runs },
  } = await octokit.checks.listForRef({
    ...repo,
    ref: sha,
  });

  const hasUnfinishedOrFailedChecks = check_runs.some((item) => {
    return item.status !== 'completed' || item.conclusion === 'failure';
  });

  return !hasUnfinishedOrFailedChecks;
};

/**
 * check whether PR is mergeable from the Approval perspective
 * the pr needs to have minimum required approvals && no request-for-changes reviews
 */
export const getApprovalStatus = async (pullNumber) => {
  const octokit = getOctokit();
  const repo = github.context.repo;
  const requiredApprovalCount = core.getInput('required_approval_count');

  const { data: reviewsData } = await octokit.pulls.listReviews({
    ...repo,
    pull_number: pullNumber,
  });

  let reviewers = new Set();
  let changesRequestedCount = 0;
  let approvalCount = 0;

  reviewsData.reverse().forEach(({ state, user }) => {
    if (reviewers.has(user.login)) return;
    if (!['CHANGES_REQUESTED', 'APPROVED'].includes(stat)) return;
    if (state === 'CHANGES_REQUESTED') changesRequestedCount += 1;
    if (state === 'APPROVED') approvalCount += 1;
    reviewers.add(user.login);
  });

  return {
    changesRequestedCount,
    approvalCount,
    requiredApprovalCount,
  };
};

/**
 * find a applicable PR to update
 */
export const getAutoUpdateCandidate = async (openPRs) => {
  if (!openPRs) return null;

  const requiredApprovalCount = core.getInput('required_approval_count');
  const requirePassedChecks = /true/i.test(core.getInput('require_passed_checks'));

  // only update `auto merge` enabled PRs
  const autoMergeEnabledPRs = openPRs.filter((item) => item.auto_merge);
  log(`Count of auto-merge enabled PRs: ${autoMergeEnabledPRs.length}`);

  for (const pr of autoMergeEnabledPRs) {
    const {
      number: pullNumber,
      head: { sha },
    } = pr;

    log(`Checking applicable status of #${pullNumber}`);

    // #1 check whether the pr has enough approvals
    const {
      changesRequestedCount,
      approvalCount,
      requiredApprovalCount,
    } = await getApprovalStatus(pullNumber);
    if (changesRequestedCount || approvalCount < requiredApprovalCount) {
      const reason = `approvalsCount: ${approvalCount}, requiredApprovalCount: ${requiredApprovalCount}, changesRequestedReviews: ${changesRequestedCount}`;
      printFailReason(pullNumber, reason);
      continue;
    }

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
        failReason = `The 'mergeable_state' value is: '${mergeable_state}'. The branch is not 'behind' the base branch`;
      }

      printFailReason(pullNumber, failReason);
      continue;
    }

    /**
     * #3 check whether the pr has failed checks
     * only happens if require_passed_checks input is true
     * need to note: the mergeable, and mergeable_state don't reflect the checks status
     */
    if (requirePassedChecks) {
      const didChecksPass = await areAllChecksPassed(sha);
      if (!didChecksPass) {
        printFailReason(pullNumber, 'The PR has failed or ongoing check(s)');
        continue;
      }
    }

    return pr;
  }

  return null;
};
