const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");

const {
  reviewRequest,
  authorize,
  writeRequest,
  reportBody,
  publish
} = require("./codex-review.cjs");

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGE_BASE = "c".repeat(40);

function fixture({ permission = "write", state = "open" } = {}) {
  const calls = [];
  const outputs = {};
  const context = {
    eventName: "issue_comment",
    actor: "maintainer",
    repo: { owner: "example", repo: "project" },
    serverUrl: "https://github.com",
    runId: 123,
    payload: {
      action: "created",
      issue: { number: 28, pull_request: {} },
      comment: {
        body: "@codex review",
        user: { login: "maintainer", type: "User" }
      }
    }
  };
  const pr = {
    number: 28,
    state,
    base: { sha: BASE, repo: { full_name: "example/project" } },
    head: { sha: HEAD, repo: { full_name: "contributor/project" } }
  };
  const github = {
    rest: {
      repos: {
        async getCollaboratorPermissionLevel({ username }) {
          calls.push(["permission", username]);
          return {
            data: {
              permission:
                typeof permission === "function"
                  ? permission(username)
                  : permission
            }
          };
        },
        async compareCommits(args) {
          calls.push(["compare", args]);
          return { data: { merge_base_commit: { sha: MERGE_BASE } } };
        }
      },
      pulls: {
        async get() {
          calls.push(["pr"]);
          return { data: pr };
        }
      },
      issues: {
        async createComment(args) {
          calls.push(["comment", args]);
        }
      }
    }
  };
  const core = {
    notice() {},
    setOutput(name, value) {
      outputs[name] = value;
    }
  };
  return { context, github, core, outputs, calls, pr };
}

test("accepts a standalone command and optional focus", () => {
  const { context } = fixture();
  for (const body of [
    "@codex review",
    "  @codex review  ",
    "@codex review\nCheck cleanup",
    "@codex review focus on accessibility"
  ]) {
    context.payload.comment.body = body;
    assert.equal(reviewRequest(context).number, 28);
  }
  for (const body of [
    "Please @codex review",
    "> @codex review",
    "`@codex review`",
    "@codex reviewer",
    "@codex review; run this",
    "@codex fix"
  ]) {
    context.payload.comment.body = body;
    assert.equal(reviewRequest(context), null);
  }
});

test("ignores bots, issues, edited comments and spoofed actors before API calls", async () => {
  for (const mutate of [
    (c) => {
      c.payload.comment.user.type = "Bot";
    },
    (c) => {
      delete c.payload.issue.pull_request;
    },
    (c) => {
      c.payload.action = "edited";
    },
    (c) => {
      c.actor = "someone-else";
    },
    (c) => {
      c.eventName = "pull_request";
    }
  ]) {
    const f = fixture();
    mutate(f.context);
    await authorize(f, "maintainer");
    assert.deepEqual(f.outputs, {});
    assert.deepEqual(f.calls, []);
  }
});

test("read/triage contributors cannot spend API credits even if associated with the repo", async () => {
  for (const permission of ["read", "triage", "none"]) {
    const f = fixture({ permission });
    f.context.payload.comment.author_association = "MEMBER";
    await authorize(f, "maintainer");
    assert.equal(f.outputs.authorized, undefined);
    assert.deepEqual(f.calls, [["permission", "maintainer"]]);
  }
});

test("requires permission for the person rerunning the workflow too", async () => {
  const f = fixture({
    permission: (name) => (name === "maintainer" ? "admin" : "read")
  });
  await authorize(f, "other-user");
  assert.equal(f.outputs.authorized, undefined);
  assert.deepEqual(f.calls, [
    ["permission", "maintainer"],
    ["permission", "other-user"]
  ]);
});

test("authorizes a maintainer reviewing a fork and pins the comparison commits", async () => {
  for (const permission of ["write", "maintain", "admin"]) {
    const f = fixture({ permission });
    await authorize(f, "maintainer");
    assert.deepEqual(f.outputs, {
      head: HEAD,
      base: BASE,
      merge_base: MERGE_BASE,
      number: "28",
      authorized: "true"
    });
    assert.deepEqual(f.calls.at(-1), [
      "compare",
      { owner: "example", repo: "project", base: BASE, head: HEAD }
    ]);
  }
});

test("does not authorize a closed PR or malformed commit", async () => {
  const closed = fixture({ state: "closed" });
  await authorize(closed, "maintainer");
  assert.equal(closed.outputs.authorized, undefined);
  const malformed = fixture();
  malformed.pr.head.sha = "$(echo injected)";
  await assert.rejects(
    authorize(malformed, "maintainer"),
    /Invalid commit SHA/
  );
  assert.equal(malformed.outputs.authorized, undefined);
});

test("treats shell syntax and GitHub expressions in focus as JSON data", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-review-test-"));
  try {
    const { context } = fixture();
    const focus =
      "Check `quoted code`, $(echo injected), and ${{ secrets.EXAMPLE }}.\nSecond line.";
    context.payload.comment.body = `@codex review\n${focus}`;
    const path = join(directory, "request.json");
    writeRequest(context, path);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      number: 28,
      focus
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("reports stale results and failures explicitly; bounds oversized output", () => {
  const values = {
    head: HEAD,
    base: BASE,
    currentHead: HEAD,
    currentBase: BASE,
    result: "success",
    message: "No findings. Static review only.",
    runUrl: "https://github.com/example/project/actions/runs/123"
  };
  assert.match(reportBody(values), /No findings/);
  for (const change of [
    { currentHead: MERGE_BASE },
    { currentBase: MERGE_BASE }
  ]) {
    assert.match(
      reportBody({ ...values, ...change }),
      /PR changed during this review/
    );
  }
  for (const change of [
    { result: "failure" },
    { result: "cancelled" },
    { message: "" }
  ]) {
    assert.match(
      reportBody({ ...values, ...change }),
      /not a clean review result/
    );
  }
  const long = reportBody({ ...values, message: "x".repeat(100000) });
  assert.ok(long.length < 60000);
  assert.match(long, /Report truncated/);
});

test("publishes to the approved PR as a comment and skips closed PRs", async () => {
  for (const state of ["open", "closed"]) {
    const f = fixture({ state });
    await publish(f, {
      PR_NUMBER: "28",
      PR_HEAD_SHA: HEAD,
      PR_BASE_SHA: BASE,
      REVIEW_RESULT: "success",
      REVIEW_MESSAGE: "Review findings"
    });
    const comment = f.calls.find(([name]) => name === "comment");
    if (state === "closed") assert.equal(comment, undefined);
    else {
      assert.equal(comment[1].issue_number, 28);
      assert.match(comment[1].body, /Review findings/);
      assert.match(comment[1].body, /actions\/runs\/123/);
    }
  }
});
