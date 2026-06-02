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
trap "rm -rf $TMPDIR" EXIT

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
npm install -g "$TARBALL"

# Verify
NEW_VERSION=$(openclaw --version 2>/dev/null || echo "unknown")
echo ""
echo "=== Upgrade Complete ==="
echo "Previous: ${CURRENT}"
echo "Current:  ${NEW_VERSION}"

# Restart gateway if running
if systemctl is-active --quiet openclaw 2>/dev/null; then
  echo ""
  echo "Restarting gateway..."
  sudo systemctl restart openclaw
  sleep 2
  if systemctl is-active --quiet openclaw 2>/dev/null; then
    echo "Gateway restarted successfully."
  else
    echo "WARNING: Gateway failed to start. Check: journalctl -u openclaw -n 50"
  fi
elif pgrep -f "openclaw-gateway" >/dev/null 2>&1; then
  echo ""
  echo "Gateway is running (not via systemd). Restart manually:"
  echo "  pkill -f openclaw-gateway && openclaw gateway run &"
else
  echo ""
  echo "No gateway running. Start with: openclaw gateway run"
fi
