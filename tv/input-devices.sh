#!/bin/sh
# Read the TV kernel input table and report physical USB and Bluetooth HID.
# Usage: sh input-devices.sh [input-devices-file]
# Output is one key=value pair per line; names may contain spaces.
set -eu
INPUTS_FILE=${1:-${LINUX_DESKTOP_INPUTS:-/proc/bus/input/devices}}

if [ ! -r "$INPUTS_FILE" ]; then
  printf '%s\n' \
    'usb_keyboard=0' 'usb_keyboard_name=' \
    'usb_pointer=0' 'usb_pointer_name=' \
    'bt_keyboard=0' 'bt_keyboard_name=' \
    'bt_pointer=0' 'bt_pointer_name='
  exit 0
fi

awk '
  function hexval(c) {
    return index("0123456789abcdef", tolower(c)) - 1
  }

  # Test one bit in a B: KEY=, B: REL=, or B: ABS= bitmap. The kernel writes
  # one 32-bit word per group, most significant word first.
  function bit_set(line, bit, s, n, w, wi, word, pos, ch, val, rem) {
    if (line == "") return 0
    s = line
    sub(/^[^=]*=/, "", s)
    n = split(s, w, " ")
    wi = int(bit / 32) + 1
    if (wi > n) return 0
    word = w[wi]
    while (length(word) < 8) word = "0" word
    pos = 8 - int((bit % 32) / 4)
    ch = tolower(substr(word, pos, 1))
    val = hexval(ch)
    if (val < 0) return 0
    rem = bit % 4
    return int(val / (2 ^ rem)) % 2
  }

  function clean_name(value) {
    gsub(/[\r\n]/, " ", value)
    sub(/^[ \t]+/, "", value)
    sub(/[ \t]+$/, "", value)
    return value
  }

  function emit() {
    # Bus 0003 devices that live under /virtual are the TV Magic Remote,
    # TONE remote, and built-in audio endpoints, not USB HID.
    if (bus == "0003" && sys !~ /virtual/) {
      if (bit_set(key, 30)) {
        usb_kbd = 1
        if (usb_kbd_name == "") usb_kbd_name = name
      }
      if ((bit_set(rel, 0) && bit_set(rel, 1)) ||
          ((bit_set(abs, 0) || bit_set(abs, 1)) &&
           (bit_set(key, 272) || bit_set(key, 330)))) {
        usb_ptr = 1
        if (usb_ptr_name == "") usb_ptr_name = name
      }
    }
    # Bluetooth HID arrives through uhid, which is virtual by design.
    if (bus == "0005") {
      if (bit_set(key, 30)) {
        bt_kbd = 1
        if (bt_kbd_name == "") bt_kbd_name = name
      }
      if ((bit_set(rel, 0) && bit_set(rel, 1)) ||
          ((bit_set(abs, 0) || bit_set(abs, 1)) &&
           (bit_set(key, 272) || bit_set(key, 330)))) {
        bt_ptr = 1
        if (bt_ptr_name == "") bt_ptr_name = name
      }
    }
  }

  /^I: Bus=/ {
    if (seen) emit()
    seen = 1
    bus = $0
    sub(/.*Bus=/, "", bus)
    sub(/ .*/, "", bus)
    sys = ""
    name = ""
    key = ""
    rel = ""
    abs = ""
    next
  }
  /^N: Name=/ {
    name = $0
    sub(/^N: Name="/, "", name)
    sub(/"$/, "", name)
    next
  }
  /^S: Sysfs=/ { sys = $0; next }
  /^B: KEY=/ { key = $0; next }
  /^B: REL=/ { rel = $0; next }
  /^B: ABS=/ { abs = $0; next }
  /^$/ {
    if (seen) { emit(); seen = 0 }
  }
  END {
    if (seen) emit()
    printf "usb_keyboard=%d\n", usb_kbd
    printf "usb_keyboard_name=%s\n", clean_name(usb_kbd_name)
    printf "usb_pointer=%d\n", usb_ptr
    printf "usb_pointer_name=%s\n", clean_name(usb_ptr_name)
    printf "bt_keyboard=%d\n", bt_kbd
    printf "bt_keyboard_name=%s\n", clean_name(bt_kbd_name)
    printf "bt_pointer=%d\n", bt_ptr
    printf "bt_pointer_name=%s\n", clean_name(bt_ptr_name)
  }
' "$INPUTS_FILE"
