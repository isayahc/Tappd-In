#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_URL="https://opencode.ai/install"

if command -v opencode >/dev/null 2>&1; then
  printf 'OpenCode is already installed: %s\n' "$(command -v opencode)"
  opencode --version
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' "curl is required to install OpenCode." >&2
  exit 1
fi

printf '%s\n' "OpenCode is not installed. Installing from the official OpenCode installer..."
printf '%s\n' "Installer: $INSTALL_URL"

curl -fsSL "$INSTALL_URL" | bash

if ! command -v opencode >/dev/null 2>&1; then
  printf '%s\n' "OpenCode was installed, but the 'opencode' command is not on PATH." >&2
  printf '%s\n' "OpenCode's installer may have updated your shell configuration. Open a new shell and try again." >&2
  exit 1
fi

printf '%s\n' "OpenCode installed successfully:"
opencode --version
