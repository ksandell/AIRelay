#!/usr/bin/env bash
# AIRelay load test — 10 concurrent groups × 100 requests, 1-2 s random delay.
# Usage: MISTRAL_API_KEY=<key> bash docs/load-test.sh
#        (or export MISTRAL_API_KEY before running)

set -euo pipefail

ENDPOINT="${AIRELAY_URL:-http://localhost:3000}/proxy/v1/chat/completions"
NUM_GROUPS="${NUM_GROUPS:-10}"
NUM_REQUESTS="${NUM_REQUESTS:-100}"

if [[ -z "${MISTRAL_API_KEY:-}" ]]; then
  echo "ERROR: MISTRAL_API_KEY is not set" >&2
  exit 1
fi

MESSAGES=(
  '{"model":"mistral-small-latest","max_tokens":30,"messages":[{"role":"user","content":"say hi"}]}'
  '{"model":"mistral-small-latest","max_tokens":30,"messages":[{"role":"user","content":"what is 2+2"}]}'
  '{"model":"mistral-small-latest","max_tokens":30,"messages":[{"role":"user","content":"name a color"}]}'
  '{"model":"mistral-small-latest","max_tokens":30,"messages":[{"role":"user","content":"say bye"}]}'
  '{"model":"mistral-small-latest","max_tokens":30,"messages":[{"role":"user","content":"count to 3"}]}'
)

run_group() {
  local GROUP=$1
  local PASS=0 FAIL=0
  for i in $(seq 1 "$NUM_REQUESTS"); do
    BODY="${MESSAGES[$((RANDOM % ${#MESSAGES[@]}))]}"
    STATUS=$(curl -sS -o /dev/null -w "%{http_code}" \
      -X POST "$ENDPOINT" \
      -H "Authorization: Bearer $MISTRAL_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$BODY")
    if [[ "$STATUS" == "200" ]]; then ((PASS++)) || true; else ((FAIL++)) || true; fi
    DELAY=$(awk -v min=1 -v max=2 'BEGIN{srand(PROCINFO["pid"]+ENVIRON["i"]); printf "%.2f\n", min+rand()*(max-min)}')
    sleep "$DELAY"
  done
  echo "Group $GROUP done: 200=$PASS non-200=$FAIL"
}

export -f run_group
export MISTRAL_API_KEY ENDPOINT NUM_REQUESTS MESSAGES

echo "Starting $NUM_GROUPS groups × $NUM_REQUESTS requests against $ENDPOINT"
for g in $(seq 1 "$NUM_GROUPS"); do
  run_group "$g" &
done

wait
echo "ALL GROUPS COMPLETE"
