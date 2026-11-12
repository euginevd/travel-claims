#!/usr/bin/env bash
# Sets GitHub up for Claude through the Anthropic API (the key from .env); on a deployed setup, also applies the units that use it.
exec bash "$(dirname "$0")/github-setup.sh" anthropic
