#!/bin/bash
set -e

if [ -n "$DOCKER_USERNAME" ] && [ -n "$DOCKER_PASSWORD" ]; then
  echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin
else
  echo "DOCKER_USERNAME or DOCKER_PASSWORD not set; skipping Docker Hub login"
fi
