#!/bin/sh
set -e
# Installer helper: copy bundled udev rule to system rules directory and reload udev
# Usage: sudo ./install-udev.sh

RULE_SRC="$(dirname "$0")/99-nfc-serial.rules"
RULE_DST="/etc/udev/rules.d/99-nfc-serial.rules"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root. Use: sudo $0"
  exit 1
fi

if [ ! -f "$RULE_SRC" ]; then
  echo "Source udev rule not found: $RULE_SRC"
  exit 1
fi

cp -f "$RULE_SRC" "$RULE_DST"
udevadm control --reload-rules
udevadm trigger --action=add
echo "Installed udev rule to $RULE_DST and reloaded udev rules"

exit 0
