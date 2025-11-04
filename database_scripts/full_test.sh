#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:3000/api"

say() { printf "\n=== %s ===\n" "$*"; }

# expect_code METHOD URL CODE [extra curl args...]
expect_code() {
  local method="$1" url="$2" code="$3"
  shift 3
  local tmp; tmp=$(mktemp)
  local http_code
  if [ "$method" = "GET" ]; then
    http_code=$(curl -sS -o "$tmp" -w '%{http_code}' "$url")
  elif [ "$method" = "DELETE" ]; then
    http_code=$(curl -sS -o "$tmp" -w '%{http_code}' -X DELETE "$url")
  else
    http_code=$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" "$@")
  fi
  if [ "$http_code" != "$code" ]; then
    echo "FAIL: $method $url expected $code, got $http_code"
    echo "Body:"; cat "$tmp"; echo
    exit 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

need_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "Install jq first: brew install jq"
    exit 1
  fi
}
need_jq

ensure_incomplete () {
  # ensure a given task id is completed=false and unassigned
  local id="$1"
  local j; j=$(curl -s "$BASE/tasks/$id")
  local nm ds dl
  nm=$(echo "$j" | jq -r '.data.name')
  ds=$(echo "$j" | jq -r '.data.description')
  dl=$(echo "$j" | jq -r '.data.deadline')
  expect_code PUT "$BASE/tasks/$id" 200 -H "Content-Type: application/json" -d "{
    \"name\":\"$nm\",
    \"description\":\"$ds\",
    \"deadline\":\"$dl\",
    \"completed\":false,
    \"assignedUser\":\"\",
    \"assignedUserName\":\"unassigned\"
  }" >/dev/null
}

say "0) Health"
expect_code GET "$BASE/health" 200 | jq .

say "1) Clean & Fill baseline via provided scripts"
( cd database_scripts && python3 dbClean.py -u "localhost" -p 3000 )
( cd database_scripts && python3 dbFill.py  -u "localhost" -p 3000 -n 20 -t 100 )

say "2) Counts must be 20 users / 100 tasks"
UCOUNT=$(curl -s "$BASE/users?count=true" | jq -r '.data')
TCOUNT=$(curl -s "$BASE/tasks?count=true" | jq -r '.data')
echo "users=$UCOUNT tasks=$TCOUNT"
[ "$UCOUNT" = "20" ] || { echo "Expected 20 users"; exit 1; }
[ "$TCOUNT" = "100" ] || { echo "Expected 100 tasks"; exit 1; }

say "3) Basic GET lists"
expect_code GET "$BASE/users" 200 | jq '.data | length'
expect_code GET "$BASE/tasks" 200 | jq '.data | length'

say "4) Query params: where / sort / select / skip+limit / count"
curl --silent --get --data-urlencode 'where={"completed":true}' "$BASE/tasks" | jq '.data | length'
curl --silent --get --data-urlencode 'sort={"name":1}' "$BASE/users" | jq '.data[0]'
curl --silent --get --data-urlencode 'select={"_id":0}' "$BASE/users" | jq '.data[0] | has("_id")' | grep false >/dev/null
expect_code GET "$BASE/tasks?skip=60&limit=20" 200 | jq '.data | length' | grep '^20$' >/dev/null
curl --silent --get --data-urlencode 'where={"completed":false}' --data-urlencode 'count=true' "$BASE/tasks" | jq -r '.data'

say "5) GET by id (+ select works on :id)"
USER_ID=$(curl -s "$BASE/users" | jq -r '.data[0]._id')
TASK_ID=$(curl -s "$BASE/tasks" | jq -r '.data[0]._id')
expect_code GET "$BASE/users/$USER_ID" 200 | jq '.data | type' | grep object >/dev/null
expect_code GET "$BASE/tasks/$TASK_ID" 200 | jq '.data | type' | grep object >/dev/null
curl --silent --get --data-urlencode 'select={"email":1,"_id":1}' "$BASE/users/$USER_ID" | jq -e '.data | has("email") and has("_id")' >/dev/null
curl --silent --get --data-urlencode 'select={"name":1,"_id":1}'  "$BASE/tasks/$TASK_ID" | jq -e '.data | has("name") and has("_id")' >/dev/null

say "6) POST create (form-encoded like class scripts)"
NOW=$(date +%s)
NEWU=$(expect_code POST "$BASE/users" 201 -H "Content-Type: application/x-www-form-urlencoded" --data "name=Test User&email=test.user+$NOW@example.com")
NEW_UID=$(echo "$NEWU" | jq -r '.data._id')
NEWT=$(expect_code POST "$BASE/tasks" 201 -H "Content-Type: application/x-www-form-urlencoded" --data "name=Standalone Task&deadline=2026-01-01T00:00:00Z&completed=false")
NEW_TID=$(echo "$NEWT" | jq -r '.data._id')
expect_code POST "$BASE/users" 400 -H "Content-Type: application/x-www-form-urlencoded" --data "name=Dup&email=test.user+$NOW@example.com" >/dev/null
expect_code POST "$BASE/tasks" 400 -H "Content-Type: application/x-www-form-urlencoded" --data "name=NoDeadline" >/dev/null

# Guarantee two incomplete tasks exist for step 8
TSAFE1=$(curl -s "$BASE/tasks" | jq -r '.data[0]._id')
TSAFE2=$(curl -s "$BASE/tasks" | jq -r '.data[1]._id')
ensure_incomplete "$TSAFE1"
ensure_incomplete "$TSAFE2"

say "7) PUT Task (assign to user) -> two-way pendingTasks update"
# pick any existing incomplete (fall back to NEW_TID)
T_UNCOMP=$(curl -s "$BASE/tasks" | jq -r '.data[] | select(.completed==false) | ._id' | head -n1)
[ -n "${T_UNCOMP:-}" ] || T_UNCOMP="$NEW_TID"
TASK_JSON=$(curl -s "$BASE/tasks/$T_UNCOMP")
T_NAME=$(echo "$TASK_JSON" | jq -r '.data.name')
T_DESC=$(echo "$TASK_JSON" | jq -r '.data.description')
T_DL=$(echo "$TASK_JSON" | jq -r '.data.deadline')
expect_code PUT "$BASE/tasks/$T_UNCOMP" 200 -H "Content-Type: application/json" -d "{
  \"name\":\"$T_NAME\",
  \"description\":\"$T_DESC\",
  \"deadline\":\"$T_DL\",
  \"completed\":false,
  \"assignedUser\":\"$NEW_UID\",
  \"assignedUserName\":\"Test User\"
}" >/dev/null
curl -s "$BASE/users/$NEW_UID" | jq -r '.data.pendingTasks[]' | grep "$T_UNCOMP" >/dev/null

say "8) PUT User (overwrite pendingTasks) -> tasks assigned/unassigned accordingly"
# Use the two guaranteed incomplete tasks
T1="$TSAFE1"
T2="$TSAFE2"
U_JSON=$(curl -s "$BASE/users/$NEW_UID")
U_NAME=$(echo "$U_JSON" | jq -r '.data.name')
U_EMAIL=$(echo "$U_JSON" | jq -r '.data.email')
expect_code PUT "$BASE/users/$NEW_UID" 200 -H "Content-Type: application/json" -d "{
  \"name\":\"$U_NAME\",
  \"email\":\"$U_EMAIL\",
  \"pendingTasks\":[\"$T1\",\"$T2\"]
}" >/dev/null
curl -s "$BASE/tasks/$T1" | jq -r '.data.assignedUser' | grep "$NEW_UID" >/dev/null
curl -s "$BASE/tasks/$T2" | jq -r '.data.assignedUser' | grep "$NEW_UID" >/dev/null

say "9) DELETE Task -> removed from user's pendingTasks"
expect_code DELETE "$BASE/tasks/$T1" 204 >/dev/null
curl -s "$BASE/users/$NEW_UID" | jq -r '.data.pendingTasks[]?' | grep "$T1" && { echo "Task $T1 still in pendingTasks"; exit 1; } || echo "OK removed"

say "10) DELETE User -> their tasks become unassigned"
ANY_T=$(curl -s "$BASE/users/$NEW_UID" | jq -r '.data.pendingTasks[0]')
if [ "${ANY_T:-null}" = "null" ] || [ -z "${ANY_T:-}" ]; then
  expect_code PUT "$BASE/tasks/$NEW_TID" 200 -H "Content-Type: application/json" -d "{
    \"name\":\"Standalone Task\",
    \"description\":\"\",
    \"deadline\":\"2026-01-01T00:00:00Z\",
    \"completed\":false,
    \"assignedUser\":\"$NEW_UID\",
    \"assignedUserName\":\"$U_NAME\"
  }" >/dev/null
  ANY_T="$NEW_TID"
fi
expect_code DELETE "$BASE/users/$NEW_UID" 204 >/dev/null
curl -s "$BASE/tasks/$ANY_T" | jq -r '.data.assignedUserName' | grep -i 'unassigned' >/dev/null

say "11) Error paths: invalid JSON / bad id / not found"
expect_code GET "$BASE/tasks?where={bad}" 400 >/dev/null
expect_code GET "$BASE/users/xyz" 400 >/dev/null
expect_code GET "$BASE/tasks/000000000000000000000000" 404 >/dev/null

say "✅ ALL TESTS PASSED"
