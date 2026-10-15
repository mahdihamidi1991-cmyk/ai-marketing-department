#!/bin/zsh
if ! cd "$(dirname "$0")"; then
  echo 'Could not open the app folder. Move the full extracted folder somewhere accessible, then try again.'
  read '?Press Enter to close.'
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3.9 or newer is required. Install Python 3 from python.org, then try again.'
  read '?Press Enter to close.'
  exit 1
fi
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
  echo 'Python 3.9 or newer is required. Update Python from python.org, then try again.'
  read '?Press Enter to close.'
  exit 1
fi
python3 server.py --open-browser
launch_status=$?
if (( launch_status != 0 )); then
  echo 'Launch failed. Please check the message above.'
  read '?Press Enter to close.'
fi
exit "$launch_status"
