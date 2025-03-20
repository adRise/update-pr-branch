const core = require('@actions/core');
const github = require('@actions/github');
const gitLib = require('./github');
const utils = require('./util');

jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('./util', () => {
  const originalUtil = jest.requireActual('./util');
  const mockList = ['log', 'printFailReason', 'wait'];
  const mockedMethods = {};
  Object.keys(originalUtil).forEach((methodName) => {
    mockedMethods[methodName] = originalUtil[methodName];
    if (mockList.includes(methodName)) {
      mockedMethods[methodName] = jest.fn();
    }
  });
  return mockedMethods;
});

const token = 'FAKE_TOKEN';
const base = 'FAKE_BASE';
const requiredApprovalCount = 2;
const pullNumber = 1111;

const fakeEnv = {
  token,
  base,
  required_approval_count: requiredApprovalCount,
  require_passed_checks: 'true',
};

const oldEnv = process.env;
const mockedRepo = { repo: { owner: 'adRise', repo: 'actions' } };
const oldContext = github.context;

beforeEach(() => {
  process.env = { ...oldEnv, ...fakeEnv };
  core.getInput.mockImplementation((name) => process.env[name]);
  github.context = mockedRepo;
});

afterEach(() => {
  process.env = oldEnv;
  github.context = oldContext;
  jest.resetAllMocks();
});

describe('updatePRBranch()', () => {
  const mockedResponse = {
    data: {
      message: 'Updating pull request branch.',
      url: 'https://github.com/repos/octocat/Hello-World/pulls/53',
    },
  };
  const mockedUpdateBranch = jest.fn().mockResolvedValue(mockedResponse);

  beforeEach(() => {
    github.getOctokit.mockReturnValue({
      rest: { pulls: { updateBranch: mockedUpdateBranch } },
    });
  });
  afterEach(() => {
    github.getOctokit.mockRestore();
  });

  test('should send the expected parameters', async () => {
    const res = await gitLib.updatePRBranch(pullNumber);

    expect(github.getOctokit).toHaveBeenCalled();
    expect(mockedUpdateBranch).toHaveBeenCalledWith({
      ...mockedRepo.repo,
      pull_number: pullNumber,
    });
    expect(res).toEqual(mockedResponse.data);
  });
});

describe('getPR()', () => {
  const mockedResponse = require('../../test/fixtures/pr_metadata.json');

  afterEach(() => {
    github.getOctokit.mockRestore();
  });

  test('should send the expected parameters', async () => {
    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);
    github.getOctokit.mockReturnValue({
      rest: { pulls: { get: mockedMethod } },
    });
    const res = await gitLib.getPR(pullNumber);

    expect(github.getOctokit).toHaveBeenCalled();
    expect(mockedMethod).toHaveBeenCalledWith({
      ...mockedRepo.repo,
      pull_number: pullNumber,
    });

    expect(res).toEqual(mockedResponse.data);
  });
});

describe('getOpenPRs()', () => {
  const mockedResponse = require('../../test/fixtures/pulls_list.json');

  afterEach(() => {
    github.getOctokit.mockRestore();
  });

  test('should send the expected parameters', async () => {
    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);
    github.getOctokit.mockReturnValue({
      rest: { pulls: { list: mockedMethod } },
    });
    const res = await gitLib.getOpenPRs(pullNumber);

    expect(github.getOctokit).toHaveBeenCalled();
    expect(mockedMethod).toHaveBeenCalledWith({
      ...mockedRepo.repo,
      base,
      state: 'open',
    });

    expect(res).toEqual(mockedResponse.data);
  });
  test('should pass sort config if set', async () => {
    process.env = {
      ...oldEnv,
      ...fakeEnv,
      sort: 'updated',
      direction: 'desc',
    };
    core.getInput.mockImplementation((name) => process.env[name]);

    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);
    github.getOctokit.mockReturnValue({
      rest: { pulls: { list: mockedMethod } },
    });
    await gitLib.getOpenPRs(pullNumber);

    expect(mockedMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: 'updated',
        direction: 'desc',
      }),
    );
  });
  test('when sort direct is not set', async () => {
    process.env = {
      ...oldEnv,
      ...fakeEnv,
      sort: 'updated',
    };
    core.getInput.mockImplementation((name) => process.env[name]);

    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);
    github.getOctokit.mockReturnValue({
      rest: { pulls: { list: mockedMethod } },
    });
    await gitLib.getOpenPRs(pullNumber);

    expect(mockedMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: 'updated',
        direction: undefined,
      }),
    );
  });
});

describe('getMergeableStatus()', () => {
  const prMetaData = require('../../test/fixtures/pr_metadata.json');
  test('will return the data directly if mergeable_state is not "unknown"', async () => {
    const mergeableStatus = {
      mergeable: true,
      mergeable_state: 'behind',
    };
    const mockedResponse = {
      data: {
        ...prMetaData.data,
        ...mergeableStatus,
      },
    };
    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);
    github.getOctokit.mockReturnValue({
      rest: { pulls: { get: mockedMethod } },
    });
    const status = await gitLib.getMergeableStatus();
    expect(status).toEqual(mergeableStatus);
    expect(mockedMethod).toHaveBeenCalledTimes(1);
  });

  test('will wait and retry after 3000ms if the mergeable_state is unknown', async () => {
    const mergeableStatus = { mergeable: null, mergeable_state: 'unknown' };
    const mergeableStatusFinal = { mergeable: true, mergeable_state: 'bebind' };
    const mockedResponse = { data: { ...prMetaData.data, ...mergeableStatus } };
    const mockedResponseFinal = {
      data: { ...prMetaData.data, ...mergeableStatusFinal },
    };
    const mockedMethod = jest
      .fn()
      .mockResolvedValueOnce(mockedResponse)
      .mockResolvedValueOnce(mockedResponseFinal);

    github.getOctokit.mockReturnValue({
      rest: { pulls: { get: mockedMethod } },
    });
    jest.spyOn(utils, 'wait').mockImplementation();

    const res = await gitLib.getMergeableStatus();
    expect(res).toEqual(mergeableStatusFinal);
    expect(mockedMethod).toHaveBeenCalledTimes(2);
    expect(utils.wait).toHaveBeenCalledWith(3000);

    utils.wait.mockRestore();
  });
});

describe('areAllChecksPassed()', () => {
  const sha = 'fake_sha';
  const mockedResponse = require('../../test/fixtures/checks_success.json');
  const oldCheck = mockedResponse.data.check_runs[0];

  afterEach(() => {
    github.getOctokit.mockReset();
    mockedResponse.data.check_runs[0] = oldCheck;
  });

  test('should return true when all checks passed', async () => {
    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);

    github.getOctokit.mockReturnValue({
      rest: { checks: { listForRef: mockedMethod } },
    });

    const result = await gitLib.areAllChecksPassed(sha);
    expect(result).toEqual(true);
  });

  test('should return false if there is failed check', async () => {
    const check = {
      ...oldCheck,
      conclusion: 'failure',
    };
    mockedResponse.data.check_runs[0] = check;
    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);

    github.getOctokit.mockReturnValue({
      rest: { checks: { listForRef: mockedMethod } },
    });

    const result = await gitLib.areAllChecksPassed(sha);
    expect(result).toEqual(false);
  });

  test('should return false if there is ongoing check', async () => {
    // mock pending check
    const check = {
      ...oldCheck,
      status: 'queued',
      conclusion: null,
    };
    mockedResponse.data.check_runs[0] = check;

    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);

    github.getOctokit.mockReturnValue({
      rest: { checks: { listForRef: mockedMethod } },
    });

    const result = await gitLib.areAllChecksPassed(sha);
    expect(result).toEqual(false);
  });

  test('should return true if there is ongoing checks but no failed checks', async () => {
    // mock pending check
    const check = {
      ...oldCheck,
      status: 'queued',
      conclusion: null,
    };
    mockedResponse.data.check_runs[0] = check;

    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);

    github.getOctokit.mockReturnValue({
      rest: { checks: { listForRef: mockedMethod } },
    });

    const allowOngoingChecks = true;
    const result = await gitLib.areAllChecksPassed(sha, allowOngoingChecks);
    expect(result).toEqual(true);
  });

  test('should return false if there is ongoing checks and failed checks', async () => {
    // mock pending check
    const check = {
      ...oldCheck,
      status: 'queued',
      conclusion: null,
    };
    const failedCheck = {
      ...oldCheck,
      conclusion: 'failure',
    };
    mockedResponse.data.check_runs[0] = check;
    mockedResponse.data.check_runs[1] = failedCheck;

    const mockedMethod = jest.fn().mockResolvedValue(mockedResponse);

    github.getOctokit.mockReturnValue({
      rest: { checks: { listForRef: mockedMethod } },
    });

    const allowOngoingChecks = true;
    const result = await gitLib.areAllChecksPassed(sha, allowOngoingChecks);
    expect(result).toEqual(false);
  });
});

describe('getApprovalStatus()', () => {
  const reviewsList = require('../../test/fixtures/list_reviews.json');

  afterEach(() => {
    github.getOctokit.mockReset();
  });

  test('should return count of concluding approved, changes-requested reviews', async () => {
    const mockedMethod = jest.fn().mockResolvedValue(reviewsList);

    github.getOctokit.mockReturnValue({
      rest: { pulls: { listReviews: mockedMethod } },
    });

    const result = await gitLib.getApprovalStatus(pullNumber);
    expect(mockedMethod).toHaveBeenCalled();
    expect(result).toEqual({
      approvalCount: 1,
      changesRequestedCount: 1,
      requiredApprovalCount: requiredApprovalCount,
    });
  });

  test('only count the latest concluding review of each reviewer', async () => {
    // 1 reviewer approved twice, one reviewer appoved but requested for change later
    const reviews = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'CHANGES_REQUESTED' },
        { ...reviewsList.data[1], state: 'COMMENTED' },
      ],
    };
    const mockedMethod = jest.fn().mockResolvedValue(reviews);

    github.getOctokit.mockReturnValue({
      rest: { pulls: { listReviews: mockedMethod } },
    });

    const result = await gitLib.getApprovalStatus(pullNumber);
    expect(mockedMethod).toHaveBeenCalled();
    expect(result).toEqual({
      approvalCount: 1,
      changesRequestedCount: 1,
      requiredApprovalCount: requiredApprovalCount,
    });
  });
});

describe('getAutoUpdateCandidate()', () => {
  const pullsList = require('../../test/fixtures/pulls_list.json');
  const reviewsList = require('../../test/fixtures/list_reviews.json');
  const prMetaData = require('../../test/fixtures/pr_metadata.json');
  const checksList = require('../../test/fixtures/checks_success.json');

  afterEach(() => {
    github.getOctokit.mockRestore();
  });

  test('return null if openPRs is undefined', async () => {
    const res = await gitLib.getAutoUpdateCandidate();
    expect(utils.log).toHaveBeenCalledTimes(0);
    expect(res).toBe(null);
  });

  test('return null if there is no open PR', async () => {
    const res = await gitLib.getAutoUpdateCandidate([]);
    expect(utils.log).toHaveBeenCalledWith(
      'Count of auto-merge enabled PRs: 0',
    );
    expect(res).toBe(null);
  });

  test('return null if there is no auto-merge enabled PR', async () => {
    const list = [];
    pullsList.data.forEach((item) => {
      list.push({
        ...item,
        auto_merge: null,
      });
    });

    const res = await gitLib.getAutoUpdateCandidate(list);
    expect(utils.log).toHaveBeenCalledWith(
      'Count of auto-merge enabled PRs: 0',
    );
    expect(res).toBe(null);
  });

  // Tests for filterPRsByLabels
  test('filterPRsByLabels should filter by included labels when provided', () => {
    // Create PR items with labels
    const prWithLabelA = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-a' }]
    };
    const prWithLabelB = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-b' }]
    };
    const prWithBothLabels = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-a' }, { name: 'label-b' }]
    };
    const prNoLabels = { 
      ...pullsList.data[0], 
      labels: []
    };
    
    const prs = [prWithLabelA, prWithLabelB, prWithBothLabels, prNoLabels];
    
    // Test with a single label filter
    core.getInput.mockImplementation((name) => {
      if (name === 'included_labels') return 'label-a';
      return '';
    });
    
    const filteredPRs = gitLib.filterPRsByLabels(prs);
    expect(filteredPRs.length).toBe(2); // Should include prWithLabelA and prWithBothLabels
    expect(filteredPRs).toContain(prWithLabelA);
    expect(filteredPRs).toContain(prWithBothLabels);
    expect(filteredPRs).not.toContain(prWithLabelB);
    expect(filteredPRs).not.toContain(prNoLabels);
    expect(utils.log).toHaveBeenCalledWith('Count of PRs with included labels: 2');
  });

  test('filterPRsByLabels should filter by multiple included labels when provided', () => {
    // Create PR items with labels
    const prWithLabelA = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-a' }]
    };
    const prWithLabelB = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-b' }]
    };
    const prWithLabelC = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-c' }]
    };
    const prNoLabels = { 
      ...pullsList.data[0], 
      labels: []
    };
    
    const prs = [prWithLabelA, prWithLabelB, prWithLabelC, prNoLabels];
    
    // Test with multiple label filters
    core.getInput.mockImplementation((name) => {
      if (name === 'included_labels') return 'label-a,label-b';
      return '';
    });
    
    const filteredPRs = gitLib.filterPRsByLabels(prs);
    expect(filteredPRs.length).toBe(2); // Should include prWithLabelA and prWithLabelB
    expect(filteredPRs).toContain(prWithLabelA);
    expect(filteredPRs).toContain(prWithLabelB);
    expect(filteredPRs).not.toContain(prWithLabelC);
    expect(filteredPRs).not.toContain(prNoLabels);
    expect(utils.log).toHaveBeenCalledWith('Count of PRs with included labels: 2');
  });

  test('filterPRsByLabels should not filter when included_labels is empty', () => {
    // Create PR items with labels
    const prWithLabel = { 
      ...pullsList.data[0], 
      labels: [{ name: 'some-label' }]
    };
    const prNoLabels = { 
      ...pullsList.data[0], 
      labels: []
    };
    
    const prs = [prWithLabel, prNoLabels];
    
    // Test with empty label filter
    core.getInput.mockImplementation((name) => {
      if (name === 'included_labels') return '';
      return '';
    });
    
    const filteredPRs = gitLib.filterPRsByLabels(prs);
    expect(filteredPRs.length).toBe(2); // Should include both PRs
    // We shouldn't log the label count if we're not filtering by labels
    expect(utils.log).not.toHaveBeenCalledWith(expect.stringMatching(/Count of PRs with included labels/));
  });

  test('filterPRsByLabels should handle labels with whitespace', () => {
    // Create PR items with labels
    const prWithLabelA = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-a' }]
    };
    const prWithLabelB = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-b' }]
    };
    
    const prs = [prWithLabelA, prWithLabelB];
    
    // Test with whitespace in label filter
    core.getInput.mockImplementation((name) => {
      if (name === 'included_labels') return ' label-a , label-b ';
      return '';
    });
    
    const filteredPRs = gitLib.filterPRsByLabels(prs);
    expect(filteredPRs.length).toBe(2); // Should handle whitespace correctly
    expect(utils.log).toHaveBeenCalledWith('Count of PRs with included labels: 2');
  });

  // Tests for filterPRsByAutoMerge
  test('filterPRsByAutoMerge should filter out PRs without auto-merge enabled', () => {
    // Create PR items with different auto-merge status
    const prWithAutoMerge = { 
      ...pullsList.data[0], 
      auto_merge: {}
    };
    const prWithoutAutoMerge = { 
      ...pullsList.data[0], 
      auto_merge: null
    };
    
    const prs = [prWithAutoMerge, prWithoutAutoMerge];
    
    // Set require_auto_merge_enabled to true
    core.getInput.mockImplementation((name) => {
      if (name === 'require_auto_merge_enabled') return 'true';
      return '';
    });
    
    const filteredPRs = gitLib.filterPRsByAutoMerge(prs);
    expect(filteredPRs.length).toBe(1); // Should only include PRs with auto-merge
    expect(filteredPRs).toContain(prWithAutoMerge);
    expect(filteredPRs).not.toContain(prWithoutAutoMerge);
    expect(utils.log).toHaveBeenCalledWith('Count of auto-merge enabled PRs: 1');
  });

  test('filterPRsByAutoMerge should include all PRs when require_auto_merge_enabled is false', () => {
    // Create PR items with different auto-merge status
    const prWithAutoMerge = { 
      ...pullsList.data[0], 
      auto_merge: {}
    };
    const prWithoutAutoMerge = { 
      ...pullsList.data[0], 
      auto_merge: null
    };
    
    const prs = [prWithAutoMerge, prWithoutAutoMerge];
    
    // Set require_auto_merge_enabled to false
    core.getInput.mockImplementation((name) => {
      if (name === 'require_auto_merge_enabled') return 'false';
      return '';
    });
    
    const filteredPRs = gitLib.filterPRsByAutoMerge(prs);
    expect(filteredPRs.length).toBe(2); // Should include all PRs
    expect(filteredPRs).toContain(prWithAutoMerge);
    expect(filteredPRs).toContain(prWithoutAutoMerge);
    // No log message about auto-merge PRs when we include all
  });

  // Tests for combined filterApplicablePRs
  test('filterApplicablePRs should combine label and auto-merge filtering', () => {
    // Create PR items with different combinations of labels and auto-merge
    const prWithLabelWithAutoMerge = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-a' }],
      auto_merge: {}
    };
    const prWithLabelWithoutAutoMerge = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-a' }],
      auto_merge: null
    };
    const prWithoutLabelWithAutoMerge = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-b' }],
      auto_merge: {}
    };
    const prWithoutLabelWithoutAutoMerge = { 
      ...pullsList.data[0], 
      labels: [{ name: 'label-b' }],
      auto_merge: null
    };
    
    const prs = [
      prWithLabelWithAutoMerge, 
      prWithLabelWithoutAutoMerge, 
      prWithoutLabelWithAutoMerge, 
      prWithoutLabelWithoutAutoMerge
    ];
    
    // Test with label filter and require auto-merge
    core.getInput.mockImplementation((name) => {
      if (name === 'included_labels') return 'label-a';
      if (name === 'require_auto_merge_enabled') return 'true';
      return '';
    });
    
    const filteredPRs = gitLib.filterApplicablePRs(prs);
    expect(filteredPRs.length).toBe(1); // Should only include PR with label-a AND auto-merge
    expect(filteredPRs).toContain(prWithLabelWithAutoMerge);
    expect(filteredPRs).not.toContain(prWithLabelWithoutAutoMerge);
    expect(filteredPRs).not.toContain(prWithoutLabelWithAutoMerge);
    expect(filteredPRs).not.toContain(prWithoutLabelWithoutAutoMerge);
    
    // Should log both counts
    expect(utils.log).toHaveBeenCalledWith('Count of PRs with included labels: 2');
    expect(utils.log).toHaveBeenCalledWith('Count of auto-merge enabled PRs: 1');
  });

  [false, 'false'].forEach((value) => {
    test(`Filter applicable PRs can exclude auto-merge if configured with ${value} (${typeof value})`, async () => {
      const data = { require_auto_merge_enabled: value };
      core.getInput.mockImplementation((name) => data[name]);
      const obtained = gitLib.filterApplicablePRs(pullsList);
      expect(obtained.length).toBe(pullsList.length);
    });
  });

  test('PR with request-for-change review will not be selected', async () => {
    const prList = [{ ...pullsList.data[0], auto_merge: {} }];
    const mockedListReviews = jest.fn().mockResolvedValue(reviewsList);
    const mockedGet = jest.fn();

    github.getOctokit.mockReturnValue({
      rest: { pulls: { listReviews: mockedListReviews, get: mockedGet } },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(mockedListReviews).toHaveBeenCalled();
    expect(utils.log).toHaveBeenCalledTimes(2);
    expect(utils.printFailReason).toHaveBeenCalledTimes(1);
    expect(utils.printFailReason).toHaveBeenCalledWith(
      prList[0].number,
      `approvalsCount: 1, requiredApprovalCount: ${requiredApprovalCount}, changesRequestedReviews: 1`,
    );
    expect(mockedGet).toHaveBeenCalledTimes(0);
    expect(res).toBe(null);
  });

  test('PR does not have enough approvals wont be selected', async () => {
    // only 1 approval, not request for change review
    const reviews = {
      ...reviewsList,
      data: [{ ...reviewsList.data[0], state: 'APPROVED' }],
    };
    const prList = [{ ...pullsList.data[0], auto_merge: {} }];
    const mockedListReviews = jest.fn().mockResolvedValue(reviews);
    const mockedGet = jest.fn();

    github.getOctokit.mockReturnValue({
      rest: { pulls: { listReviews: mockedListReviews, get: mockedGet } },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(mockedListReviews).toHaveBeenCalled();
    expect(utils.log).toHaveBeenCalledTimes(2);
    expect(utils.printFailReason).toHaveBeenCalledTimes(1);
    expect(utils.printFailReason).toHaveBeenCalledWith(
      prList[0].number,
      `approvalsCount: 1, requiredApprovalCount: ${requiredApprovalCount}, changesRequestedReviews: 0`,
    );
    expect(mockedGet).toHaveBeenCalledTimes(0);
    expect(res).toBe(null);
  });

  test('PR with mergeable !== true will not be selected', async () => {
    // has 2 approvals, not request for change review
    const reviews = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'APPROVED' },
      ],
    };
    const prData = {
      data: {
        ...prMetaData.data,
        ...{ mergeable: null, mergeable_state: 'behind' },
      },
    };

    // has auto-merge PR
    const prList = [{ ...pullsList.data[0], auto_merge: {} }];
    const mockedListReviews = jest.fn().mockResolvedValue(reviews);
    const mockedGet = jest.fn().mockResolvedValue(prData);

    github.getOctokit.mockReturnValue({
      rest: { pulls: { listReviews: mockedListReviews, get: mockedGet } },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(utils.printFailReason).toHaveBeenCalledWith(
      prList[0].number,
      "The 'mergeable' value is: null",
    );
    expect(res).toBe(null);
  });

  test('PR with mergeable_state === unknown will not be selected', async () => {
    // has 2 approvals, no request for change review
    const reviews = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'APPROVED' },
      ],
    };
    // pr mergeable: true, merge_state: clean
    const prData = {
      data: {
        ...prMetaData.data,
        ...{ mergeable: true, mergeable_state: 'clean' },
      },
    };

    // has auto-merge PR
    const prList = [{ ...pullsList.data[0], auto_merge: {} }];
    const mockedListReviews = jest.fn().mockResolvedValue(reviews);
    const mockedGet = jest.fn().mockResolvedValue(prData);

    github.getOctokit.mockReturnValue({
      rest: { pulls: { listReviews: mockedListReviews, get: mockedGet } },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(utils.printFailReason).toHaveBeenCalledWith(
      prList[0].number,
      "The 'mergeable_state' value is: 'clean'. The branch is not 'behind' the base branch",
    );
    expect(res).toBe(null);
  });

  test('PR with failed checks wont be selected', async () => {
    // has 2 approvals, no request for change review
    const reviews = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'APPROVED' },
      ],
    };
    // pr mergeable: true, merge_state: clean
    const prData = {
      data: {
        ...prMetaData.data,
        ...{ mergeable: true, mergeable_state: 'behind' },
      },
    };

    const check = checksList.data.check_runs[0];
    const checks = {
      ...checksList,
      data: {
        total_count: 2,
        check_runs: [
          { ...check, conclusion: 'success' },
          { ...check, conclusion: 'failure' },
        ],
      },
    };

    // has auto-merge PR
    const prList = [{ ...pullsList.data[0], auto_merge: {} }];
    const mockedListReviews = jest.fn().mockResolvedValue(reviews);
    const mockedGet = jest.fn().mockResolvedValue(prData);
    const mockedListForRef = jest.fn().mockResolvedValue(checks);

    github.getOctokit.mockReturnValue({
      rest: {
        pulls: { listReviews: mockedListReviews, get: mockedGet },
        checks: { listForRef: mockedListForRef },
      },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(utils.printFailReason).toHaveBeenCalledWith(
      prList[0].number,
      'The PR has failed or ongoing check(s)',
    );
    expect(res).toBe(null);
  });
  test('PR with failed checks will be selected if require_passed_checks is false', async () => {
    process.env.require_passed_checks = 'false';

    // has 2 approvals, no request for change review
    const reviews = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'APPROVED' },
      ],
    };
    // pr mergeable: true, merge_state: clean
    const prData = {
      data: {
        ...prMetaData.data,
        ...{ mergeable: true, mergeable_state: 'behind' },
      },
    };

    const check = checksList.data.check_runs[0];
    const checks = {
      ...checksList,
      data: {
        total_count: 2,
        check_runs: [
          { ...check, conclusion: 'success' },
          { ...check, conclusion: 'failure' },
        ],
      },
    };

    // has auto-merge PR
    const prList = [{ ...pullsList.data[0], auto_merge: {} }];
    const mockedListReviews = jest.fn().mockResolvedValue(reviews);
    const mockedGet = jest.fn().mockResolvedValue(prData);
    const mockedListForRef = jest.fn().mockResolvedValue(checks);

    github.getOctokit.mockReturnValue({
      rest: {
        pulls: { listReviews: mockedListReviews, get: mockedGet },
        checks: { listForRef: mockedListForRef },
      },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(res).toBe(prList[0]);
  });

  test('Should return the first PR if it is all good', async () => {
    // has 2 approvals, no request for change review
    const reviews = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'APPROVED' },
      ],
    };
    // pr mergeable: true, merge_state: clean
    const prData = {
      data: {
        ...prMetaData.data,
        ...{ mergeable: true, mergeable_state: 'behind' },
      },
    };

    const check = checksList.data.check_runs[0];
    const checks = {
      ...checksList,
      data: {
        total_count: 2,
        check_runs: [
          { ...check, conclusion: 'success' },
          { ...check, conclusion: 'success' },
        ],
      },
    };

    // has auto-merge PR
    const prList = [{ ...pullsList.data[0], auto_merge: {} }];
    const mockedListReviews = jest.fn().mockResolvedValue(reviews);
    const mockedGet = jest.fn().mockResolvedValue(prData);
    const mockedListForRef = jest.fn().mockResolvedValue(checks);

    github.getOctokit.mockReturnValue({
      rest: {
        pulls: { listReviews: mockedListReviews, get: mockedGet },
        checks: { listForRef: mockedListForRef },
      },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(res).toEqual(prList[0]);
  });

  // this test is to mock the case: two auto-merge enabled PRs, but the first one has CHANGES_REQUESTED review,
  //  the method should check the second one
  test('Should return the first applicable PR in the list', async () => {
    // has 2 approvals, no request for change review
    const reviewsFirst = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'CHANGES_REQUESTED' },
      ],
    };
    const reviewsSecond = {
      ...reviewsList,
      data: [
        { ...reviewsList.data[0], state: 'APPROVED' },
        { ...reviewsList.data[1], state: 'APPROVED' },
      ],
    };
    // pr mergeable: true, merge_state: clean
    const prData = {
      data: {
        ...prMetaData.data,
        ...{ mergeable: true, mergeable_state: 'behind' },
      },
    };

    const check = checksList.data.check_runs[0];
    const checks = {
      ...checksList,
      data: {
        total_count: 2,
        check_runs: [
          { ...check, conclusion: 'success' },
          { ...check, conclusion: 'success' },
        ],
      },
    };

    // has auto-merge PR
    const prFirst = { ...pullsList.data[0], auto_merge: {} };
    const prSecond = {
      ...pullsList.data[0],
      number: pullNumber,
      auto_merge: {},
    };
    const prList = [prFirst, prSecond];
    // mock and set the first PR has CHANGES_REQUESTED review
    const mockedListReviews = jest
      .fn()
      .mockResolvedValueOnce(reviewsFirst)
      .mockResolvedValueOnce(reviewsSecond);

    const mockedGet = jest.fn().mockResolvedValue(prData);
    const mockedListForRef = jest.fn().mockResolvedValue(checks);

    github.getOctokit.mockReturnValue({
      rest: {
        pulls: { listReviews: mockedListReviews, get: mockedGet },
        checks: { listForRef: mockedListForRef },
      },
    });

    const res = await gitLib.getAutoUpdateCandidate(prList);
    expect(res).toEqual(prList[1]);
  });
});
