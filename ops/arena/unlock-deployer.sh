#!/usr/bin/env bash
# Run interactively as root on yunipals-main. Never paste the password into chat.
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo "Run this on the production server as root."; exit 1; }
arena_unlock_dir=/run/yunipals-arena-deploy
install -d -m 700 "$arena_unlock_dir"
IFS= read -r -s -p "Password for yunipals-arena-deployer: " arena_unlock_password
printf '\n'
[[ -n $arena_unlock_password ]] || { echo "No password saved."; exit 1; }
arena_unlock_tmp=$(mktemp "$arena_unlock_dir/.password.XXXXXX")
printf '%s' "$arena_unlock_password" > "$arena_unlock_tmp"
unset arena_unlock_password
chmod 600 "$arena_unlock_tmp"
mv "$arena_unlock_tmp" "$arena_unlock_dir/password"
echo "Temporary root-only password file is ready. Tell Codex 'ready'; it will be deleted after use."
