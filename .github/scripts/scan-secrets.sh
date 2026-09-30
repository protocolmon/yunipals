#!/usr/bin/env bash
set -euo pipefail

task_scan_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/yunipals-secrets.XXXXXX")
trap 'rm -rf "$task_scan_dir"' EXIT
task_archive="$task_scan_dir/gitleaks.tar.gz"
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  --output "$task_archive"
printf '%s  %s\n' \
  551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb \
  "$task_archive" | sha256sum --check --status
tar -xzf "$task_archive" -C "$task_scan_dir" gitleaks
task_scanner="$task_scan_dir/gitleaks"

"$task_scanner" git . --redact --verbose --log-opts=HEAD
"$task_scanner" dir . --redact

for task_vendor in apps/yunipals-indexer/vendor/*.tgz; do
  test -f "$task_vendor"
  task_unpacked=$(mktemp -d "$task_scan_dir/vendor.XXXXXX")
  tar -xzf "$task_vendor" -C "$task_unpacked" --no-same-owner --no-same-permissions
  "$task_scanner" dir "$task_unpacked" --redact
done
