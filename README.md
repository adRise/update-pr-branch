# PR Auto Updater Action

This Github action is designed to work with the Github `auto-merge` feature.
The action will try to update the branch of the newest open PR that matches the below conditions

- The PR has the auto-merge option enabled
- The PR has 2 approvals and no changes-requested review
- The PR has all checks passed
- The PR branch has no conflicts with the base branch
- The PR branch is behind the base branch

## Inputs

### `token`

**Required**

The [personal access token](https://github.com/settings/tokens/).

Need to note, you can't use `GITHUB_TOKEN` because of [this limitation](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#triggering-new-workflows-using-a-personal-access-token)

### `base`

**Required**

Default: `master`

The base branch that the PR will use to get PRs, for example, `main`, `master` or `dev`.

The action will only check PRs that use the `base` as the base branch.

### `required_approval_count`

**Required**

Default: 2

The action will skip PRs that have less approvals than `required_approval_count`.

We could retrieve this value from the repo settings through an API call but that will incure one more request. Github has [rate limit](https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration#usage-limits) on API usage of Github actions.

> API requests - You can execute up to 1000 API requests in an hour across all actions within a repository. If exceeded, additional API calls will fail, which might cause jobs to fail.

## Example usage

```yml
name: PR update

on:
  push:
    branches:
      - 'master'
jobs:
  autoupdate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          ref: 'master'
      - name: Automatically update PR
        uses: actions/pr_updater@VERSION_YOU_WANT_TO_USE
        with:
          token: ${{ secrets.ACTION_USER_TOKEN }}
          base: 'master'
          required_approval_count: 2
```

Replace the `VERSION_YOU_WANT_TO_USE` with the actual version you want to use, check the version format [here](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#jobsjob_idstepsuses)

## Development

```bash
yarn
# this compile index.js to dest/init.js for running
yarn build
```

Note: You need to run `yarn build` before commit the changes because when the action only use the compiled `dest/index.js`.
