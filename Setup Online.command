#!/bin/zsh
cd "$(dirname "$0")" || exit 1
python3 public_setup.py
status_code=$?
read '?Press Enter to close.'
exit "$status_code"
