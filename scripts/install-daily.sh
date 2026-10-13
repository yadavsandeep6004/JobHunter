#!/bin/zsh
# Runs `npm run process` daily via macOS launchd (ChatGPT writes emails for posts you sent with 📩).
# Usage:  ./scripts/install-daily.sh [HH] [MM]      (default 09:00)
# Remove: ./scripts/install-daily.sh --uninstall
set -euo pipefail

LABEL="com.jobhunter.process"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed daily schedule."
  exit 0
fi

HOUR="${1:-9}"
MINUTE="${2:-0}"
NPM="$(command -v npm)"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir -p "$ROOT/data" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>ProgramArguments</key>
  <array><string>$NPM</string><string>run</string><string>process</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>
  <key>StandardOutPath</key><string>$ROOT/data/process.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/process.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
printf "Scheduled daily at %02d:%02d. Log: %s/data/process.log\n" "$HOUR" "$MINUTE" "$ROOT"
