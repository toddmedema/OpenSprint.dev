#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is required."
  exit 1
fi

repo="${1:-${GITHUB_REPOSITORY:-}}"
branch="${2:-main}"

if [[ -z "${repo}" ]]; then
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ "${origin_url}" =~ github.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
    repo="${BASH_REMATCH[1]}"
  fi
fi

if [[ -z "${repo}" ]]; then
  echo "Could not determine GitHub repo. Pass <owner/repo> as the first argument."
  exit 1
fi

payload="$(cat <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build", "lint", "test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
)"

curl --fail --silent --show-error \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${repo}/branches/${branch}/protection" \
  -d "${payload}" >/dev/null

echo "Branch protection updated for ${repo}:${branch}"
