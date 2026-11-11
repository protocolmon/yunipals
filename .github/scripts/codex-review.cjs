const { writeFileSync } = require("node:fs");

function reviewRequest(context) {
  const { action, issue, comment } = context.payload;
  if (
    context.eventName !== "issue_comment" ||
    action !== "created" ||
    !issue?.pull_request ||
    comment?.user?.type !== "User" ||
    comment.user.login !== context.actor
  ) {
    return null;
  }
  const match = /^@codex review(?:\s+([\s\S]*))?$/.exec(comment.body.trim());
  return match ? { number: issue.number, focus: match[1]?.trim() || "" } : null;
}

async function authorize({ github, context, core }, triggeringActor) {
  const request = reviewRequest(context);
  if (!request) return;

  // Check current permissions, not author_association or the PR author's role.
  for (const username of new Set([context.actor, triggeringActor])) {
    if (!username) throw new Error("Missing triggering actor.");
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...context.repo,
      username
    });
    if (!new Set(["write", "maintain", "admin"]).has(data.permission)) {
      core.notice("Codex reviews require repository write access.");
      return;
    }
  }

  const { data: pr } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: request.number
  });
  if (pr.state !== "open") {
    core.notice("Codex reviews only open pull requests.");
    return;
  }
  if (pr.base.repo.full_name !== `${context.repo.owner}/${context.repo.repo}`) {
    throw new Error("Pull request belongs to another repository.");
  }
  const { data: comparison } = await github.rest.repos.compareCommits({
    ...context.repo,
    base: pr.base.sha,
    head: pr.head.sha
  });
  const commits = {
    head: pr.head.sha,
    base: pr.base.sha,
    merge_base: comparison.merge_base_commit.sha
  };
  for (const [name, sha] of Object.entries(commits)) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid commit SHA.");
    core.setOutput(name, sha);
  }
  core.setOutput("number", String(request.number));
  core.setOutput("authorized", "true");
}

function writeRequest(context, destination) {
  const request = reviewRequest(context);
  if (!request) throw new Error("Invalid review request.");
  // Keep comment text out of shell commands and executable GitHub expressions.
  writeFileSync(destination, JSON.stringify(request, null, 2));
}

function reportBody({
  head,
  base,
  currentHead,
  currentBase,
  result,
  message,
  runUrl
}) {
  const stale = head !== currentHead || base !== currentBase;
  const header = [
    "## Codex review",
    `Reviewed head: \`${head}\`; base: \`${base}\`.`,
    stale
      ? "**The PR changed during this review. These findings apply to the commits above. Request a new review for the current changes.**"
      : "",
    `[Workflow run](${runUrl})`,
    ""
  ]
    .filter(Boolean)
    .join("\n\n");
  const feedback =
    result === "success" && message.trim()
      ? message.trim()
      : "The review did not complete. Check the workflow run for details (including whether OPENAI_API_KEY is configured), then post a new review request. This is not a clean review result.";
  const limit = 55000;
  const body = `${header}\n\n${feedback}`;
  return body.length <= limit
    ? body
    : `${body.slice(0, limit)}\n\n_Report truncated; see the workflow run for the full output._`;
}

async function publish({ github, context }, env) {
  const { data: pr } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: Number(env.PR_NUMBER)
  });
  // Closed/merged PRs need no new review comment.
  if (pr.state !== "open") return;
  const body = reportBody({
    head: env.PR_HEAD_SHA,
    base: env.PR_BASE_SHA,
    currentHead: pr.head.sha,
    currentBase: pr.base.sha,
    result: env.REVIEW_RESULT,
    message: env.REVIEW_MESSAGE || "",
    runUrl: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
  });
  await github.rest.issues.createComment({
    ...context.repo,
    issue_number: pr.number,
    body
  });
}

module.exports = {
  reviewRequest,
  authorize,
  writeRequest,
  reportBody,
  publish
};
