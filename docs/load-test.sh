#!/usr/bin/env bash
# Load test S8: 10 concurrent groups × 100 requests each (1 000 total).
# Random 1–2 s delay between requests within each group; all groups fire in parallel.
# Usage: MISTRAL_API_KEY=... bash docs/load-test.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://airelay-dev.local:3000}"
KEY="${MISTRAL_API_KEY:-}"
N_GROUPS=10
REQS_PER_GROUP=100
TOTAL=$((N_GROUPS * REQS_PER_GROUP))

if [[ -z "$KEY" ]]; then
  echo "ERROR: MISTRAL_API_KEY not set" >&2
  exit 1
fi

TMPDIR_RESULTS=$(mktemp -d)
trap 'rm -rf "$TMPDIR_RESULTS"' EXIT

one_group() {
  local gid=$1
  local success=0 fail=0 total_ms=0
  local times=()
  for i in $(seq 1 "$REQS_PER_GROUP"); do
    sleep "$(awk 'BEGIN{srand(); printf "%.2f", 1+rand()}')"
    t0=$(date +%s%3N)
    code=$(curl -sS -o /dev/null -w "%{http_code}" \
      -X POST "$BASE_URL/proxy/v1/chat/completions" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d '{"model":"mistral-small-latest","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}' \
      --max-time 30 2>/dev/null || echo "000")
    t1=$(date +%s%3N)
    ms=$(( t1 - t0 ))
    times+=("$ms")
    if [[ "$code" == "200" ]]; then
      (( success++ )) || true
    else
      (( fail++ )) || true
    fi
  done
  # Write per-group results
  (IFS=$'\n'; echo "${times[*]}") > "$TMPDIR_RESULTS/g${gid}.times"
  echo "$success $fail" > "$TMPDIR_RESULTS/g${gid}.summary"
}

echo "Starting load test: $N_GROUPS groups × $REQS_PER_GROUP requests = $TOTAL total"
echo "Target: $BASE_URL"
START_EPOCH=$(date +%s%3N)

pids=()
for g in $(seq 1 "$N_GROUPS"); do
  one_group "$g" &
  pids+=($!)
done
for pid in "${pids[@]}"; do
  wait "$pid"
done

END_EPOCH=$(date +%s%3N)
ELAPSED=$(( END_EPOCH - START_EPOCH ))

# Aggregate
total_ok=0; total_fail=0
all_times=()
for g in $(seq 1 "$N_GROUPS"); do
  read -r ok fail < "$TMPDIR_RESULTS/g${g}.summary"
  total_ok=$(( total_ok + ok ))
  total_fail=$(( total_fail + fail ))
  while IFS= read -r t; do all_times+=("$t"); done < "$TMPDIR_RESULTS/g${g}.times"
done

# Sort for percentiles
IFS=$'\n' sorted=($(sort -n <<<"${all_times[*]}")); unset IFS
count=${#sorted[@]}
p50=${sorted[$((count / 2))]}
p95=${sorted[$((count * 95 / 100))]}
p99=${sorted[$((count * 99 / 100))]}

echo ""
echo "=== Load test results ==="
echo "Total:    $total_ok / $TOTAL ✓  (fail: $total_fail)"
echo "p50:      ${p50} ms"
echo "p95:      ${p95} ms"
echo "p99:      ${p99} ms"
echo "Duration: ${ELAPSED} ms"

# Pass criteria
PASS=1
[[ $total_ok -eq $TOTAL ]] || { echo "FAIL: not all 200"; PASS=0; }
[[ $p50 -le 400 ]] || { echo "WARN: p50 ${p50} > 400 ms (reference 245 ms)"; }
[[ $p95 -le 600 ]] || { echo "WARN: p95 ${p95} > 600 ms (reference 427 ms)"; }

if [[ $PASS -eq 1 ]]; then
  echo "PASS"
else
  echo "FAIL"
  exit 1
fi
