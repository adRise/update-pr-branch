import * as core from '@actions/core';
import { getOpenPRs, getAutoUpdateCandidate, log, updatePRBranch } from './lib/github';

async function main() {
  try {
    const openPRs = await getOpenPRs();

    const pr = await getAutoUpdateCandidate(openPRs);
    if (!pr) {
      log('No applicable PR to update.');
      return;
    }

    const { number: pullNumber } = pr;

    // update the pr
    log(`Trying to update PR branch #${pullNumber}`);

    // TODO (zhiye): try next the PR in the queue if update fails
    try {
      await updatePRBranch(pullNumber);
      log('Successful updated. Cheers 🎉!')
    } catch (err) {
      core.setFailed(`Fail to update PR with error: ${err}`);
    }
  } catch (err) {
    core.setFailed(`Action failed with error ${err}`);
  }
}

main();
