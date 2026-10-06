#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Denies the commands an AI session must never run by itself:
# git push, terraform apply/destroy, reading secrets, and bypassing the local git hooks.
# Best-effort text matching over the raw command: it is a guard rail, not a security boundary
# (`git push` is enforced for real by the pre-push git hook; see the deny list in settings.json).
set -u

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

deny() {
  jq -n --arg reason "Blocked by guard.sh: $1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# One line per simple command: drop quotes, split on ; & | ( ) { } and backticks.
norm=$(printf '%s' "$cmd" | tr -d "\"'" | tr ';&|(){}`' '\n\n\n\n\n\n\n\n')

GIT_OPTS='([[:space:]]+(-C|-c|--git-dir|--work-tree|--namespace|--exec-path)(=|[[:space:]]+)[^[:space:]]+|[[:space:]]+--?[[:alnum:]-]+)*'
TF_OPTS='([[:space:]]+-chdir=[^[:space:]]+)*'
READERS='cat|less|more|head|tail|bat|nl|tac|sed|awk|grep|egrep|rg|ag|xxd|od|strings|base64|cp|mv|scp|rsync|curl|source|\.'
SECRET_PATH='(^|[[:space:]/=<~])((\.env(\.[[:alnum:]_-]+)?|(prod|production|staging|local)\.env|[[:alnum:]_.-]+\.(tfvars|pem|key|p8|p12|jks))($|[[:space:]])|environments/|\.(ssh|aws|netrc|npmrc|kube)(/|$|[[:space:]])|\.config/gcloud)'

check() {
  local seg="$1" prev=""
  if [[ $seg =~ (^|[[:space:]])HUSKY=0 ]]; then
    deny "HUSKY=0 would skip the local git hooks."
  fi
  # ltrim, then peel env assignments and transparent wrappers, then an absolute path to the binary
  seg="${seg#"${seg%%[![:space:]]*}"}"
  while [ "$seg" != "$prev" ]; do
    prev="$seg"
    seg=$(printf '%s' "$seg" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|exec|sudo|nohup|time|nice)[[:space:]]+//')
  done
  seg=$(printf '%s' "$seg" | sed -E 's#^/[^[:space:]]*/([^/[:space:]]+)#\1#')
  [ -n "$seg" ] || return 0

  if [[ $seg =~ ^git${GIT_OPTS}[[:space:]]+push([[:space:]]|$) ]]; then
    deny "git push is run by the human from a plain terminal, never by an AI session."
  fi
  if [[ $seg =~ ^(terraform|tofu)${TF_OPTS}[[:space:]]+(apply|destroy)([[:space:]]|$) ]]; then
    deny "terraform apply/destroy runs only in CI, never from an AI session."
  fi
  if [[ $seg =~ ^(terraform|tofu)${TF_OPTS}[[:space:]]+(output[[:space:]]+(-raw|-json)|show|state[[:space:]]+(show|pull)) ]]; then
    deny "this terraform command prints state or secret values."
  fi
  if [[ $seg =~ ^gcloud[[:space:]]+secrets[[:space:]]+versions[[:space:]]+access ]] || [[ $seg =~ ^gcloud[[:space:]].*print-(access|identity)-token ]]; then
    deny "reading secrets or tokens from gcloud is not allowed from an AI session."
  fi
  if [[ $seg =~ ^git[[:space:]] ]]; then
    if [[ $seg =~ --no-verify ]] || [[ $seg =~ ^git${GIT_OPTS}[[:space:]]+commit[[:space:]]+(.*[[:space:]])?-[a-zA-Z]*n[a-zA-Z]*([[:space:]]|$) ]]; then
      deny "--no-verify would skip the local git hooks (secret scan, pre-push guard)."
    fi
    if [[ $seg =~ core\.hooksPath ]]; then
      deny "changing core.hooksPath would disable the local git hooks."
    fi
  fi

  local scrubbed
  scrubbed=$(printf '%s' "$seg" | sed -E 's/\.(env|tfvars)\.(example|sample|template)//g')
  if [[ $scrubbed =~ ^(${READERS})[[:space:]] ]] || [[ $scrubbed =~ \<[[:space:]]*[^[:space:]] ]]; then
    if [[ $scrubbed =~ $SECRET_PATH ]]; then
      deny "reading .env / *.tfvars / keys / ~/.ssh / ~/.aws / gcloud config is not allowed from an AI session."
    fi
  fi
}

while IFS= read -r line; do
  check "$line"
  if [[ $line =~ ^[[:space:]]*(sh|bash|zsh|dash|ksh)[[:space:]]+(-[[:alnum:]]+[[:space:]]+)*-[[:alnum:]]*c[[:space:]]+(.*)$ ]]; then
    check "${BASH_REMATCH[3]}"
  fi
done <<< "$norm"

exit 0
