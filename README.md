# CLA Signatures

This branch stores contributor CLA signatures for the
[`zonghaoyuan/infiplot`](https://github.com/zonghaoyuan/infiplot) repository.

It is an **orphan branch** (no shared history with `main`/`staging`) and is
**intentionally unprotected** so the CLA Assistant GitHub Action can commit
signature records directly via the `CLA_BOT_TOKEN` PAT.

## Why a separate branch?

The CLA Assistant action cannot push to branch-protection-protected branches
(`main`, `staging`). Storing signatures on a dedicated unprotected branch is
the workaround recommended by the action maintainers (see
[contributor-assistant/github-action#150](https://github.com/contributor-assistant/github-action/issues/150)).

## Contents

- `cla-signatures/version-1.json` — signature store, managed automatically by
  the CLA Assistant action. Do not edit by hand.

## DO NOT

- Do **not** add branch protection rules to this branch — the action would
  stop being able to record signatures.
- Do **not** cherry-pick or merge this branch into `main`/`staging`; it has
  no shared history and exists solely to hold signature data.
