#!/usr/bin/env bash
# Table-driven tests for .claude/hooks/guard.sh. Usage: .claude/hooks/guard.test.sh   (exit 1 on any failure)
DIR="$(cd "$(dirname "$0")" && pwd)"; GUARD="${GUARD:-$DIR/guard.sh}"
fail=0
t() { # expected(deny|allow) command
  local out; out=$(jq -n --arg c "$2" '{tool_name:"Bash",tool_input:{command:$c}}' | "$GUARD")
  local got=allow; [[ $out == *'"deny"'* ]] && got=deny
  if [ "$got" = "$1" ]; then echo "ok   [$1] $2"; else echo "FAIL [want $1, got $got] $2"; fail=1; fi
}
# --- push
t deny  'git push'
t deny  'git push origin feat/x'
t deny  'git -C api push -u origin feat/x'
t deny  'git -c push.default=current push'
t deny  'git --no-pager push'
t deny  "git 'push' origin main"
t deny  '/usr/bin/git push'
t deny  'cd api && git push'
t deny  'echo ok; git push origin main'
t deny  "bash -c 'git push origin main'"
t deny  'GIT_SSH_COMMAND=x git push'
t allow 'git status'
t allow 'git commit -m "fix: push notifications copy"'
t allow 'git log --oneline --grep=push'
t allow 'git diff origin/main..HEAD'
# --- terraform
t deny  'terraform apply'
t deny  'terraform apply -auto-approve'
t deny  'terraform -chdir=infra apply'
t deny  'tofu destroy'
t deny  "sh -c 'terraform apply -help'"
t deny  'terraform output -raw database_url'
t deny  'terraform show -json'
t allow 'terraform plan'
t allow 'terraform fmt -check -recursive'
t allow 'terraform validate'
t allow 'terraform output'
# --- secrets
t deny  'cat .env'
t deny  'cat api/.env'
t deny  'head -5 app/.env.local'
t deny  'grep API_KEY apps/api-public/environments/prod.env'
t deny  'source .env'
t deny  'cat terraform.tfvars'
t deny  'cat ~/.ssh/id_ed25519'
t deny  'cp key.pem /tmp/x'
t deny  'gcloud secrets versions access latest --secret=api-config'
t deny  'gcloud auth print-access-token'
t deny  'sed -n 1,5p < .env'
t allow 'cat .env.example'
t allow 'cat terraform.tfvars.example'
t allow 'ls -la'
t allow 'echo ".env" >> .gitignore'
t allow 'grep -rn "process.env" src'
t allow 'cat package.json'
# --- bypass of local hooks
t deny  'git commit --no-verify -m x'
t deny  'git commit -nm x'
t deny  'git push --no-verify'
t deny  'HUSKY=0 git commit -m x'
t deny  'git config core.hooksPath /dev/null'
t allow 'git commit -m "feat: add x"'
t allow 'git commit --amend --no-edit'
# --- npm credentials
t deny  'cat ~/.npmrc'
t deny  'grep token ~/.npmrc'
t allow 'npm config get registry'
t allow 'npm test'
exit $fail
