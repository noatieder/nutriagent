#!/usr/bin/env bash
set -e

if [ -z "$GROQ_API_KEY" ]; then
  echo "ERROR: GROQ_API_KEY env var is not set" >&2
  exit 1
fi

sed -i "s/__GROQ_API_KEY__/${GROQ_API_KEY}/g" groqclient.js
echo "Build complete — API key injected."
