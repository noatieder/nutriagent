#!/usr/bin/env bash
set -e

if [ -z "$GROQ_API_KEY" ]; then
  echo "ERROR: GROQ_API_KEY env var is not set" >&2
  exit 1
fi

sed -i "s/__GROQ_API_KEY__/${GROQ_API_KEY}/g" groqclient.js
echo "Groq API key injected."

if [ -n "$OPENAI_API_KEY" ]; then
  sed -i "s/__OPENAI_API_KEY__/${OPENAI_API_KEY}/g" groqclient.js
  echo "OpenAI API key injected."
else
  echo "OPENAI_API_KEY not set — OpenAI models will require manual key entry."
fi

echo "Build complete."
