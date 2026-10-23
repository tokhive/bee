#!/bin/sh
# Installs the latest Bee release for this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/tokhive/bee/main/install.sh | sh
#
# BEE_VERSION=v0.1.0 picks a release; BEE_INSTALL_DIR (default ~/.local/bin)
# picks where bee goes. Linux also enables a systemd service for the installing
# user. Set BEE_INSTALL_SERVICE=0 to install only the binary.
# Set BEE_INSTALL_INTERACTIVE=0 to skip the setup/start prompts.
set -eu

repository=tokhive/bee
directory=${BEE_INSTALL_DIR:-"$HOME/.local/bin"}

fail() {
	echo "install.sh: $*" >&2
	exit 1
}

case $(uname -s) in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) fail "Bee runs on macOS and Linux; this is $(uname -s)" ;;
esac
case $(uname -m) in
x86_64 | amd64) arch=amd64 ;;
arm64 | aarch64) arch=arm64 ;;
*) fail "no Bee build for $(uname -m)" ;;
esac

install_service=${BEE_INSTALL_SERVICE:-0}
if [ "$os" = linux ]; then
	install_service=${BEE_INSTALL_SERVICE:-1}
fi
case "$install_service" in
0 | 1) ;;
*) fail "BEE_INSTALL_SERVICE=$install_service; expected 0 or 1" ;;
esac
interactive=${BEE_INSTALL_INTERACTIVE:-1}
case "$interactive" in
0 | 1) ;;
*) fail "BEE_INSTALL_INTERACTIVE=$interactive; expected 0 or 1" ;;
esac

service_path=/etc/systemd/system/tokhive-bee.service
service_marker='# Managed by Bee install.sh.'

as_root() {
	if [ "$install_uid" = 0 ]; then
		"$@"
	else
		sudo "$@"
	fi
}

shell_quote() {
	printf "'"
	printf '%s' "$1" | sed "s/'/'\\\\''/g"
	printf "'"
}

service_help() {
	printf 'Pair or validate: %s login --config %s' "$(shell_quote "$directory/bee")" "$(shell_quote "$config_path")"
	if [ ! -f "$config_path" ]; then
		printf " --hive '<Hive URL>'"
	fi
	printf '\nSelect accounts: %s setup --config %s --egress-config %s\n' "$(shell_quote "$directory/bee")" "$(shell_quote "$config_path")" "$(shell_quote "$egress_path")"
	echo "Start the service: sudo systemctl start tokhive-bee"
	echo "Check it: sudo systemctl status tokhive-bee"
	echo "Logs: sudo journalctl -u tokhive-bee -f"
	echo "Upgrades take effect after: sudo systemctl restart tokhive-bee"
}

# Keep the command's original diagnostics and exit status visible.
wizard_command() {
	operation=$1
	shift
	"$@" || {
		status=$?
		echo "install.sh: $operation failed (exit $status); Bee configuration: $config_path" >&2
		exit "$status"
	}
}

read_service_state() {
	service_state=$(wizard_command 'systemctl show ActiveState for tokhive-bee' systemctl show --property=ActiveState --value tokhive-bee)
}

confirm() {
	while :; do
		printf '%s ' "$1"
		IFS= read -r answer || return 1
		case "$answer" in
		[yY] | [yY][eE][sS]) return 0 ;;
		[nN] | [nN][oO]) return 1 ;;
		'') [ "$2" = yes ]; return ;;
		*) echo "Please answer yes or no." ;;
		esac
	done
}

service_wizard() {
	read_service_state
	case "$service_state" in
	active)
		echo "Bee is already running. Restart to apply this installation."
		confirm 'Restart Bee now? [y/N]' no || return 0
		wizard_command 'systemctl restart tokhive-bee' as_root systemctl restart tokhive-bee
		;;
	inactive | failed)
		confirm 'Set up and start Bee now? [Y/n]' yes || return 0
		if [ -f "$config_path" ]; then
			wizard_command 'bee login' "$directory/bee" login --config "$config_path"
		else
			while :; do
				printf 'Hive address: '
				IFS= read -r hive || return 0
				[ -n "$hive" ] && break
				echo "Hive address must not be empty."
			done
			wizard_command 'bee login' "$directory/bee" login --config "$config_path" --hive "$hive"
		fi
		[ -f "$config_path" ] || fail "bee login returned success but $config_path is missing; service was not started"
		if [ ! -f "$egress_path" ]; then
			wizard_command 'bee setup' "$directory/bee" setup --config "$config_path" --egress-config "$egress_path"
		fi
		[ -f "$egress_path" ] || fail "bee setup returned success but $egress_path is missing; service was not started"
		wizard_command 'systemctl start tokhive-bee' as_root systemctl start tokhive-bee
		;;
	activating | reloading | deactivating)
		echo "Bee service is $service_state; leaving the current process in place."
		return 0
		;;
	*) fail "tokhive-bee ActiveState=$service_state; expected active, inactive, failed, activating, reloading, or deactivating" ;;
	esac
	read_service_state
	[ "$service_state" = active ] || fail "tokhive-bee ActiveState=$service_state after service operation; expected active (check: sudo journalctl -u tokhive-bee)"
	echo "Bee service is active."
}

# Environment= and ExecStart= have different dollar expansion rules. Both
# accept quoted strings and percent specifiers; none of these values is a shell
# command. Refuse line breaks so an environment value cannot add unit settings.
single_line() {
	carriage_return=$(printf '\r')
	case "$2" in
	*"$carriage_return"* | *'
'*) fail "$1 contains a line break; systemd settings must occupy one line" ;;
	esac
}

unit_quote() {
	printf '"'
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'
	printf '"'
}

unit_argument() {
	unit_quote "$1" | sed 's/\$/$$/g'
}

optional_environment() {
	if [ "$2" = x ]; then
		single_line "$1" "$3"
		printf 'Environment=%s\n' "$(unit_quote "$1=$3")"
	fi
}

if [ "$install_service" = 1 ]; then
	[ "$os" = linux ] || fail "systemd service installation requires Linux; detected $os"
	install_uid=$(id -u)
	install_user=$(id -un)
	if [ "$install_uid" = 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
		fail "installer is running as root via sudo for $SUDO_USER; run it as $SUDO_USER without sudo so Bee uses that user's configuration"
	fi
	config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
	case "$HOME" in
	/*) ;;
	*) fail "HOME=$HOME; systemd service installation requires an absolute home directory" ;;
	esac
	case "$config_home" in
	/*) ;;
	*) fail "XDG_CONFIG_HOME=$config_home; Bee requires an absolute configuration directory" ;;
	esac
	single_line HOME "$HOME"
	single_line BEE_INSTALL_DIR "$directory"
	single_line XDG_CONFIG_HOME "$config_home"
	single_line PATH "$PATH"
	codex_environment=$(optional_environment CODEX_HOME "${CODEX_HOME+x}" "${CODEX_HOME-}")
	claude_environment=$(optional_environment CLAUDE_CONFIG_DIR "${CLAUDE_CONFIG_DIR+x}" "${CLAUDE_CONFIG_DIR-}")
	claude_secure_environment=$(optional_environment CLAUDE_SECURESTORAGE_CONFIG_DIR "${CLAUDE_SECURESTORAGE_CONFIG_DIR+x}" "${CLAUDE_SECURESTORAGE_CONFIG_DIR-}")
	command -v systemctl >/dev/null 2>&1 || fail "systemctl was not found on PATH; set BEE_INSTALL_SERVICE=0 to install only the binary"
	systemctl show-environment >/dev/null || fail "systemctl show-environment failed; a running system systemd manager is required (set BEE_INSTALL_SERVICE=0 for binary-only installation)"
	if [ "$install_uid" != 0 ]; then
		command -v sudo >/dev/null 2>&1 || fail "sudo was not found on PATH for user $install_user; system service installation needs administrator access (set BEE_INSTALL_SERVICE=0 for binary-only installation)"
		sudo -v || fail "sudo authorization failed for $install_user while preparing $service_path"
	fi
	if as_root test -L "$service_path"; then
		fail "$service_path is a symbolic link; remove or migrate the existing service before installing Bee's managed service"
	fi
	if as_root test -e "$service_path" && ! as_root grep -Fxq "$service_marker" "$service_path"; then
		fail "$service_path already exists and is not managed by this installer; migrate it first, or set BEE_INSTALL_SERVICE=0 to keep it"
	fi
	if systemctl --user is-enabled --quiet tokhive-bee 2>/dev/null || systemctl --user is-active --quiet tokhive-bee 2>/dev/null; then
		fail "user-level tokhive-bee is enabled or active for $install_user; run 'systemctl --user disable --now tokhive-bee' before installing the system service"
	fi
fi

if [ -n "${BEE_VERSION:-}" ]; then
	base="https://github.com/$repository/releases/download/$BEE_VERSION"
else
	base="https://github.com/$repository/releases/latest/download"
fi
archive="bee_${os}_${arch}.tar.gz"

if command -v sha256sum >/dev/null 2>&1; then
	sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
	sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
	fail "need sha256sum or shasum to verify the download"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "Downloading $base/$archive"
curl -fsSL -o "$work/$archive" "$base/$archive" || fail "download failed"
curl -fsSL -o "$work/checksums.txt" "$base/checksums.txt" || fail "checksum download failed"
expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$work/checksums.txt")
[ -n "$expected" ] || fail "$archive is not listed in checksums.txt"
[ "$(sha256 "$work/$archive")" = "$expected" ] || fail "checksum mismatch for $archive"

tar -xzf "$work/$archive" -C "$work" bee
mkdir -p "$directory"
# Replace through a rename, so a running bee keeps its old file.
cp "$work/bee" "$directory/.bee.new"
chmod 755 "$directory/.bee.new"
mv -f "$directory/.bee.new" "$directory/bee"
echo "Installed $("$directory/bee" version) to $directory/bee"

case ":$PATH:" in
*":$directory:"*) ;;
*) echo "Add $directory to your PATH, for example: export PATH=\"$directory:\$PATH\"" ;;
esac

if [ "$install_service" = 1 ]; then
	# Resolve relative installation paths and symlinks before recording ExecStart.
	directory=$(cd "$directory" && pwd -P)
	single_line BEE_INSTALL_DIR "$directory"
	config_path="$config_home/tokhive/bee.json"
	egress_path="$config_home/tokhive/egress.json"
	cat > "$work/tokhive-bee.service" <<EOF
$service_marker
[Unit]
Description=TokHive Bee
After=network.target

[Service]
Type=simple
User=$install_user
Environment=$(unit_quote "HOME=$HOME")
Environment=$(unit_quote "XDG_CONFIG_HOME=$config_home")
Environment=$(unit_quote "PATH=$PATH")
$codex_environment
$claude_environment
$claude_secure_environment
ExecCondition=/usr/bin/test -f $(unit_argument "$config_path")
ExecCondition=/usr/bin/test -f $(unit_argument "$egress_path")
# The shell program is fixed; paths are positional arguments, never shell code.
# exec replaces the shell with Bee, so systemd supervises Bee's process directly.
ExecStart=/bin/sh -c $(unit_argument 'exec "$@"') bee $(unit_argument "$directory/bee") run --config $(unit_argument "$config_path") --egress-config $(unit_argument "$egress_path")
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
	as_root install -m 644 "$work/tokhive-bee.service" "$service_path" || fail "could not install $service_path for user $install_user"
	as_root systemctl daemon-reload || fail "systemctl daemon-reload failed after installing $service_path"
	as_root systemctl enable tokhive-bee || fail "systemctl enable tokhive-bee failed for $service_path"
	echo "Enabled tokhive-bee at boot, running as $install_user without an SSH login."
	# stdout alone does not imply a controlling terminal. Probe in a subshell so
	# failure to open /dev/tty cannot abort unattended installation. Never read
	# answers from the script's stdin: it may still contain curl's script body.
	if [ "$interactive" = 1 ] && [ -t 1 ] && (exec 2>/dev/null; : <>/dev/tty); then
		service_wizard </dev/tty
	fi
	service_help
else
	printf 'Start Bee and complete setup: %s start\n' "$(shell_quote "$directory/bee")"
fi
