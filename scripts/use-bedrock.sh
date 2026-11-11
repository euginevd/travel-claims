#!/usr/bin/env bash
# Sets GitHub up for Claude through Bedrock in Sydney; on a deployed setup, also applies the units that use it.
exec bash "$(dirname "$0")/github-setup.sh" bedrock
