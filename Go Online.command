#!/bin/zsh
cd "$(dirname "$0")" || exit 1
echo 'Keep this window open while using your published department. Ctrl+C stops sharing.'
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i python3 public_server.py --tunnel
else
  python3 public_server.py --tunnel
fi
status_code=$?
if (( status_code != 0 )); then read '?Press Enter to close.'; fi
exit "$status_code"
