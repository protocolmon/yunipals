# On-demand Codex reviews

After `codex-review.yml` is merged into the default branch, add a new comment
on an open PR's **Conversation** tab:

```text
@codex review
```

Optionally include a focus in the same comment:

```text
@codex review
Focus on accessibility and animation cleanup.
```

The commenter must currently have write, maintain or admin access. Contributors
without that access and bots cannot start paid reviews. The permission check also
covers a different person rerunning a workflow. Inline diff comments and edits to
existing comments do not trigger reviews; post a new conversation comment.

Configure `OPENAI_API_KEY` as a repository Actions **secret**. This uses API
billing. An optional Actions **variable**, `CODEX_REVIEW_MODEL`, selects a model;
otherwise the Codex CLI default is used. No ChatGPT browser login is required.
If the hosted Codex GitHub integration is also enabled, the same mention may
trigger both services; use only one review integration to avoid duplicate reviews.

The review pins the PR head, base and merge-base commits at authorization time.
It works for forks by fetching those Git objects without checking out contributed
code. The workflow, prompt, scripts and agent guidance come from the trusted
default-branch checkout. Codex uses a read-only sandbox with dropped sudo privileges
and no repository write token. It performs static analysis; builds and tests run
in regular CI. A separate job posts the report with the reviewed commits and a
workflow link, and flags results as stale if the PR head or base moved meanwhile.

Reviews do not start automatically on pushes. Post a new command to review new
commits. Failed or empty reviews produce a failure comment, never a clean result.
The review job times out after 20 minutes. Reports are advisory comments; this
workflow cannot approve or merge PRs. Keep normal CI and human merge approvals.

## Why this design

- [OpenAI's action security guidance](https://github.com/openai/codex-action/blob/bdf19a4a223ec2549a3e2274a0cf61556bc07675/docs/security.md)
  recommends restricting triggers, treating PR instructions as untrusted, dropping
  sudo and putting publication in another job. This workflow follows those boundaries.
- [The Agents SDK maintainers](https://developers.openai.com/blog/skills-agents-sdk)
  use Codex for correctness review while keeping architectural and product decisions
  with people. Our reports remain advisory alongside deterministic CI.
- [Datadog's reported evaluation](https://openai.com/index/datadog/) used historical
  incident PRs and engineer feedback to assess usefulness. For this repository,
  start with several known bug-fix PRs and clean counterexamples; track useful
  findings and false positives before considering any required AI review policy.
- [Custom review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex)
  should capture a few scoped behavioral invariants rather than duplicate lint
  rules. The prompt asks for concrete failures and verification against related code.
- Public implementations such as
  [slash-codex](https://github.com/elithrar/slash-codex) read prompts from a trusted
  branch and check maintainer permissions;
  [Fullcase's example workflow](https://github.com/dalemoncayo/fullcase-web/blob/main/.github/workflows/codex-review.yml)
  separates analysis and publication. These are implementation examples, not
  independent evidence of review accuracy. We use the official action directly.

Run the workflow's permission/trigger/report tests locally with:

```sh
node --test .github/scripts/codex-review.test.cjs
```
