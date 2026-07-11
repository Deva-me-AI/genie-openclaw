#!/usr/bin/env bash
# genie-upgrade.sh — Upgrade Genie server to the latest fork release (tarball method)
# Usage: bash genie-upgrade.sh [version-tag]
# Example: bash genie-upgrade.sh v2026.2.20
#          bash genie-upgrade.sh          # auto-detects latest release
#
# This script:
#   1. Downloads the pre-built tarball from the latest GitHub Release
#   2. Installs it globally via npm
#   3. Restarts the gateway if running
#
# Prerequisites:
#   - gh CLI authenticated with repo read access (already set up on Genie servers)
#   - Node >= 22
#
set -euo pipefail

REPO="Deva-me-AI/genie-openclaw"
TAG="${1:-}"

echo "=== Genie Upgrade ==="

# Check Node version
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node >= 22 required (found v${NODE_VERSION})"
  exit 1
fi

# Check gh CLI
if ! command -v gh &>/dev/null; then
  echo "ERROR: gh CLI not found. Install it: https://cli.github.com/"
  exit 1
fi

# Get current version
CURRENT=$(openclaw --version 2>/dev/null || echo "not installed")
echo "Current version: ${CURRENT}"

# Resolve tag
if [ -z "$TAG" ]; then
  echo "Fetching latest release..."
  TAG=$(gh release view --repo "$REPO" --json tagName -q '.tagName' 2>/dev/null)
  if [ -z "$TAG" ]; then
    echo "ERROR: No releases found in $REPO"
    exit 1
  fi
fi
echo "Target version:  ${TAG}"

# Check if already on this version
if [ "$CURRENT" = "${TAG#v}" ] || [ "$CURRENT" = "$TAG" ]; then
  echo "Already on ${TAG}. Nothing to do."
  exit 0
fi

# Download tarball
TMPDIR=$(mktemp -d)
GATEWAY_SERVICE_SCOPE=""
GATEWAY_SERVICE_UNIT=""
GATEWAY_STOPPED=0
GATEWAY_RESTORED=0

start_gateway_service() {
  if [ "$GATEWAY_SERVICE_SCOPE" = "user" ]; then
    systemctl --user start "$GATEWAY_SERVICE_UNIT"
  elif [ "$GATEWAY_SERVICE_SCOPE" = "system" ]; then
    sudo systemctl start "$GATEWAY_SERVICE_UNIT"
  fi
}

wait_for_gateway_health() {
  for _ in {1..15}; do
    if openclaw gateway health --json >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

cleanup() {
  status=$?
  rm -rf "$TMPDIR"
  if [ "$status" -ne 0 ] && [ "$GATEWAY_STOPPED" -eq 1 ] && [ "$GATEWAY_RESTORED" -eq 0 ]; then
    echo "Attempting to restore the previously running gateway..." >&2
    start_gateway_service || echo "ERROR: Gateway recovery start failed." >&2
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

echo "Downloading tarball for ${TAG}..."
gh release download "$TAG" --repo "$REPO" --pattern "*.tgz" --dir "$TMPDIR"

TARBALL=$(ls "$TMPDIR"/*.tgz 2>/dev/null | head -1)
if [ -z "$TARBALL" ]; then
  echo "ERROR: No .tgz file found in release ${TAG}"
  echo "Available assets:"
  gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[].name'
  exit 1
fi

echo "Installing $(basename $TARBALL)..."

# Stop the managed gateway before replacing its package tree. Keep the scope
# and unit so the same service is restored after the upgrade.
if command -v systemctl &>/dev/null; then
  if systemctl --user is-active --quiet openclaw-gateway.service 2>/dev/null; then
    GATEWAY_SERVICE_SCOPE="user"
    GATEWAY_SERVICE_UNIT="openclaw-gateway.service"
  elif systemctl is-active --quiet openclaw-gateway.service 2>/dev/null; then
    GATEWAY_SERVICE_SCOPE="system"
    GATEWAY_SERVICE_UNIT="openclaw-gateway.service"
  elif systemctl is-active --quiet openclaw.service 2>/dev/null; then
    GATEWAY_SERVICE_SCOPE="system"
    GATEWAY_SERVICE_UNIT="openclaw.service"
  fi
fi

if [ "$GATEWAY_SERVICE_SCOPE" = "user" ]; then
  echo "Stopping gateway service before upgrade..."
  systemctl --user stop "$GATEWAY_SERVICE_UNIT"
  GATEWAY_STOPPED=1
elif [ "$GATEWAY_SERVICE_SCOPE" = "system" ]; then
  echo "Stopping gateway service before upgrade..."
  sudo systemctl stop "$GATEWAY_SERVICE_UNIT"
  GATEWAY_STOPPED=1
elif pgrep -f "openclaw-gateway" >/dev/null 2>&1; then
  echo "ERROR: Gateway is running outside a managed systemd service."
  echo "Stop it before upgrading so npm does not replace files under the live process."
  exit 1
fi

npm install -g "$TARBALL"

# Verify
if ! NEW_VERSION=$(openclaw --version 2>/dev/null); then
  echo "ERROR: Installed openclaw CLI did not report a version." >&2
  exit 1
fi
EXPECTED_VERSION="${TAG#v}"
if [ "$NEW_VERSION" != "$EXPECTED_VERSION" ] && [ "$NEW_VERSION" != "$TAG" ]; then
  echo "ERROR: Installed version ${NEW_VERSION} does not match requested release ${TAG}." >&2
  exit 1
fi
echo ""
echo "=== Upgrade Complete ==="
echo "Previous: ${CURRENT}"
echo "Current:  ${NEW_VERSION}"

# Restart the same managed gateway that was running before the upgrade.
if [ "$GATEWAY_SERVICE_SCOPE" = "user" ]; then
  echo ""
  echo "Restarting gateway..."
  start_gateway_service
  sleep 2
  if systemctl --user is-active --quiet "$GATEWAY_SERVICE_UNIT" 2>/dev/null && wait_for_gateway_health; then
    GATEWAY_RESTORED=1
    echo "Gateway restarted successfully."
  else
    echo "ERROR: Gateway failed to start or become healthy. Check: journalctl --user -u $GATEWAY_SERVICE_UNIT -n 50" >&2
    exit 1
  fi
elif [ "$GATEWAY_SERVICE_SCOPE" = "system" ]; then
  echo ""
  echo "Restarting gateway..."
  start_gateway_service
  sleep 2
  if systemctl is-active --quiet "$GATEWAY_SERVICE_UNIT" 2>/dev/null && wait_for_gateway_health; then
    GATEWAY_RESTORED=1
    echo "Gateway restarted successfully."
  else
    echo "ERROR: Gateway failed to start or become healthy. Check: journalctl -u $GATEWAY_SERVICE_UNIT -n 50" >&2
    exit 1
  fi
else
  echo ""
  echo "No gateway running. Start with: openclaw gateway run"
fi
