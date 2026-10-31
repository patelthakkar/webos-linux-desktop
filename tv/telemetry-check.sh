#!/bin/sh
# Read-only LG data-collection check for the Tails first-run warning.
# Runs on the TV. LINUX_DESKTOP_PREFS points at a fixture directory for tests.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

PREF=${LINUX_DESKTOP_PREFS:-/var/luna/preferences}
WB=${LINUX_DESKTOP_WEBOSBREW:-/var/lib/webosbrew}

value() {
  [ -r "$1" ] || return 0
  grep -o "\"$2\":\"[^\"]*\"" "$1" 2>/dev/null | head -n 1 | sed 's/.*:"//; s/"$//'
}

flag() {
  [ -r "$1" ] || return 0
  grep -o "\"$2\":\(true\|false\)" "$1" 2>/dev/null | head -n 1 | sed 's/.*://'
}

items=
issues=
unknown=0
checked=0

add() { # key state flag issue
  items="${items}{\"key\":\"$1\",\"state\":\"$2\"},"
  case "$2" in
    unknown) unknown=$((unknown + 1)) ;;
    *) checked=$((checked + 1)) ;;
  esac
  if [ "$4" = 1 ] && [ "$2" = on ]; then issues="${issues}\"$1\","; fi
}

# One setting: on unless the TV says off.
opt() { # key file setting bad
  raw=$(value "$2" "$3")
  case "$raw" in
    off|false|0) add "$1" off 0 "$4" ;;
    '') add "$1" unknown 0 "$4" ;;
    *) add "$1" on 0 "$4" ;;
  esac
}

# Several consent flags: on if any of them is true.
any_flag() { # key file bad flag...
  key=$1 file=$2 bad=$3
  shift 3
  found=
  state=off
  for name in "$@"; do
    raw=$(flag "$file" "$name")
    [ -n "$raw" ] || continue
    found=1
    [ "$raw" = true ] && state=on
  done
  [ -n "$found" ] || state=unknown
  add "$key" "$state" 0 "$bad"
}

opt liveplus "$PREF/option" livePlus 1
opt watch_history "$PREF/option" watchedListCollection 1
opt screen_ads "$PREF/general" screenSaverAd 1
any_flag acr_consent "$PREF/eula" 1 acrAllowed acrGdprAllowed
any_flag acr_ads "$PREF/eula" 1 acrOnAllowed acrAdAllowed
any_flag custom_ads "$PREF/eula" 1 customAdAllowed customadsAllowed
any_flag data_sharing "$PREF/eula" 1 additionalDataAllowed marketingOnAllowed shoppingOnAllowed
any_flag voice "$PREF/eula" 1 voiceAllowed voice2Allowed
any_flag remote_diag "$PREF/eula" 1 remoteDiagAllowed

blocker=off
blocker_rules=0
if [ -r "$WB/lifesgoodwithoutspying.hosts" ]; then
  blocker_rules=$(wc -l < "$WB/lifesgoodwithoutspying.hosts" | tr -d ' ')
  [ "$blocker_rules" -gt 0 ] && blocker=on
fi
add blocker "$blocker" 0 0

updates=open
[ -e "$PREF/webosbrew_block_updates" ] && updates=blocked
add updates "$updates" 0 0

ok=true
[ -z "$issues" ] || ok=false
[ "$unknown" = 0 ] || ok=false

comma() { printf '%s' "$1" | sed 's/,$//'; }
printf '{"ok":%s,"checked":%s,"unknown":%s,"blockerRules":%s,"issues":[%s],"items":[%s]}\n' \
  "$ok" "$checked" "$unknown" "$blocker_rules" "$(comma "$issues")" "$(comma "$items")"
