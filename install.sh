#!/bin/sh
# Installs the latest Bee release for this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/tokhive/bee/main/install.sh | sh
#
# BEE_VERSION=v0.1.0 picks a release; BEE_INSTALL_DIR (default ~/.local/bin)
# picks where bee goes. Linux also enables a systemd service for the installing
# user. Set BEE_INSTALL_SERVICE=0 to install only the binary.
# Set BEE_INSTALL_INTERACTIVE=0 to skip the setup/start prompts.
# BEE_LANG=zh or en selects a language without showing the language menu.
set -eu

repository=tokhive/bee
directory=${BEE_INSTALL_DIR:-"$HOME/.local/bin"}
installed=0
lang=${BEE_LANG:-}
if [ -z "$lang" ]; then
	case ${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}} in
	zh*) lang=zh ;;
	*) lang=en ;;
	esac
fi

message() {
	if [ "$lang" = zh ]; then message_format=$2; else message_format=$1; fi
	shift 2
	# Formats are installer-owned literals; paths and user input are arguments.
	# shellcheck disable=SC2059
	printf "$message_format" "$@"
}

rich_output() { [ -t 1 ] && [ "${TERM:-}" != dumb ]; }

line() {
	case "$1" in
	title) ui_mark='🐝'; ui_plain=''; ui_tint=36 ;;
	success) ui_mark='✅'; ui_plain='[OK]'; ui_tint=32 ;;
	wait) ui_mark='⏳'; ui_plain='[...]'; ui_tint=33 ;;
	warn) ui_mark='🟡'; ui_plain='[!]'; ui_tint=33 ;;
	error) ui_mark='❌'; ui_plain='[ERROR]'; ui_tint=31 ;;
	done) ui_mark='🎉'; ui_plain='[OK]'; ui_tint=32 ;;
	esac
	if rich_output; then
		if [ -z "${NO_COLOR:-}" ]; then
			printf '\033[%sm%s %s\033[0m\n' "$ui_tint" "$ui_mark" "$2"
		else
			printf '%s %s\n' "$ui_mark" "$2"
		fi
	else
		printf '%s%s\n' "${ui_plain:+$ui_plain }" "$2"
	fi
}

rule() {
	printf '\n'
	if rich_output; then
		if [ "${1:-}" = major ]; then
			printf '%s\n' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
		else
			printf '%s\n' '────────────────────────────────────────'
		fi
	else
		printf '%s\n' '----------------------------------------'
	fi
}

step() {
	rule
	if rich_output && [ -z "${NO_COLOR:-}" ]; then
		printf '\033[36m[%s/3] %s\033[0m\n\n' "$1" "$2"
	else
		printf '[%s/3] %s\n\n' "$1" "$2"
	fi
}

failure() {
	failure_code=$1
	shift
	{
		line error "install.sh: $*"
		if [ "$installed" = 1 ]; then
			message 'The installed program and existing configuration have been kept.\n' '已保留安装的程序和已有配置。\n'
			message 'Fix the reported error, then run the installer again.\n' '请根据错误提示处理后重新运行安装脚本。\n'
			if [ "$install_service" = 1 ]; then
				printf '  sudo journalctl -u tokhive-bee -n 50 --no-pager\n'
			fi
		fi
	} >&2
	exit "$failure_code"
}

fail() {
	failure 1 "$@"
}

case "$lang" in
zh | en) ;;
*) fail "BEE_LANG=$lang; expected zh or en" ;;
esac

case $(uname -s) in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) fail "$(message 'Bee runs on macOS and Linux; this is %s' 'Bee 支持 macOS 和 Linux；当前系统为 %s' "$(uname -s)")" ;;
esac
case $(uname -m) in
x86_64 | amd64) arch=amd64 ;;
arm64 | aarch64) arch=arm64 ;;
*) fail "$(message 'no Bee build for %s' '没有适用于 %s 的 Bee 构建' "$(uname -m)")" ;;
esac

install_service=${BEE_INSTALL_SERVICE:-0}
if [ "$os" = linux ]; then
	install_service=${BEE_INSTALL_SERVICE:-1}
fi
case "$install_service" in
0 | 1) ;;
*) fail "$(message 'BEE_INSTALL_SERVICE=%s; expected 0 or 1' 'BEE_INSTALL_SERVICE=%s；允许值为 0 或 1' "$install_service")" ;;
esac
interactive=${BEE_INSTALL_INTERACTIVE:-1}
case "$interactive" in
0 | 1) ;;
*) fail "$(message 'BEE_INSTALL_INTERACTIVE=%s; expected 0 or 1' 'BEE_INSTALL_INTERACTIVE=%s；允许值为 0 或 1' "$interactive")" ;;
esac

# Probe in a subshell: a missing controlling tty must not abort installation.
can_prompt=0
if [ -t 1 ] && (exec 2>/dev/null; : <>/dev/tty); then can_prompt=1; fi

select_language() {
	printf '请选择语言 / Choose a language\n  1) 简体中文\n  2) English\n\n'
	while :; do
		printf '请选择 / Select [1-2]: '
		if ! IFS= read -r language_answer; then
			interactive=0
			printf '\n'
			return
		fi
		case "$language_answer" in
		1) lang=zh; return ;;
		2) lang=en; return ;;
		*) printf '请选择 1 或 2 / Select 1 or 2.\n' ;;
		esac
	done
}

line title 'TokHive Bee'
rule major
if [ "$interactive" = 1 ] && [ "$can_prompt" = 1 ] && [ -z "${BEE_LANG:-}" ]; then
	select_language </dev/tty
fi

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

service_status_help() {
	printf '\n'
	message 'View connection and accounts:\n  %s status --config %s\n' '查看连接与账号：\n  %s status --config %s\n' "$(shell_quote "$directory/bee")" "$(shell_quote "$config_path")"
	message 'Check service:\n  sudo systemctl status tokhive-bee\n' '查看服务状态：\n  sudo systemctl status tokhive-bee\n'
	message 'View logs:\n  sudo journalctl -u tokhive-bee -f\n' '查看运行日志：\n  sudo journalctl -u tokhive-bee -f\n'
}

service_help() {
	rule
	message 'Manual setup and startup\n\n' '手动配置并启动\n\n'
	message 'Pair or validate: %s login --config %s' '配对或验证设备：%s login --config %s' "$(shell_quote "$directory/bee")" "$(shell_quote "$config_path")"
	if [ ! -f "$config_path" ]; then
		printf " --hive '<Hive URL>'"
	fi
	printf '\n'
	if [ ! -f "$egress_path" ]; then
		message 'Select accounts: %s setup --config %s --egress-config %s\n' '选择供给账号：%s setup --config %s --egress-config %s\n' "$(shell_quote "$directory/bee")" "$(shell_quote "$config_path")" "$(shell_quote "$egress_path")"
	fi
	message 'Start the service: sudo systemctl start tokhive-bee\n' '启动服务：sudo systemctl start tokhive-bee\n'
	service_status_help
	message 'Apply an upgrade later: sudo systemctl restart tokhive-bee\n' '稍后应用更新：sudo systemctl restart tokhive-bee\n'
}

run_bee() {
	BEE_LANG="$lang" BEE_INSTALL_UI=1 "$directory/bee" "$@"
}

# Keep the command's original diagnostics and exit status visible.
wizard_command() {
	operation=$1
	shift
	"$@" || {
		status=$?
		failure "$status" "$(message '%s failed (exit %s); Bee configuration: %s' '%s 失败（退出码 %s）；Bee 配置：%s' "$operation" "$status" "$config_path")"
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
		*) message 'Please answer yes or no.\n' '请输入 y 或 n，回车采用默认选项。\n' ;;
		esac
	done
}

# Match Bee's flock on bee.json.lock before moving the rejected credential.
# Run in a subshell so fd 9 is released before the next bee login takes its lock.
backup_pairing() (
	umask 077
	[ ! -L "$config_path.lock" ] || fail "$(message '%s is a symbolic link; configuration was not moved' '%s 是符号链接；未移动设备配置' "$config_path.lock")"
	exec 9>>"$config_path.lock"
	flock -n 9 || fail "$(message 'could not acquire configuration lock %s; stop other Bee processes and retry' '无法获得配置锁 %s；请停止其他 Bee 进程后重试' "$config_path.lock")"
	[ -f "$config_path" ] && [ ! -L "$config_path" ] || fail "$(message '%s is no longer a regular configuration file; refusing to move it' '%s 已不是常规配置文件；拒绝移动' "$config_path")"
	if cmp "$config_path" "$work/previous-bee.json" >/dev/null; then
		:
	else
		compare_status=$?
		if [ "$compare_status" = 1 ]; then
			fail "$(message '%s changed since pairing validation; configuration was not moved, run the installer again' '%s 在配对验证后发生变化；未移动配置，请重新运行安装器' "$config_path")"
		fi
		failure "$compare_status" "$(message 'could not compare %s with its validated snapshot (exit %s); configuration was not moved' '无法比较 %s 与验证前快照（退出码 %s）；未移动配置' "$config_path" "$compare_status")"
	fi
	backup_directory=$(mktemp -d "$config_path.backup.XXXXXX") || fail "$(message 'could not create a private backup directory beside %s' '无法在 %s 旁创建私有备份目录' "$config_path")"
	wizard_command "$(message 'back up device configuration' '备份设备配置')" mv "$config_path" "$backup_directory/bee.json"
	line success "$(message 'Previous device configuration backed up to %s' '旧设备配置已备份至 %s' "$backup_directory/bee.json")"
)

pairing_cancelled() {
	line warn "$(message 'Installation and existing configuration kept. Bee was not started.' '已保留安装和已有配置，尚未启动 Bee。')"
	message 'Run the installer again to resume setup or choose re-pairing.\n' '重新运行安装器可继续配置或选择重新配对。\n'
}

# Returns false only when the user cancels; command failures exit the installer.
pair_device() {
	repair_pairing=0
	if [ -f "$config_path" ]; then
		wizard_command "$(message 'snapshot device configuration' '保存设备配置快照')" cp "$config_path" "$work/previous-bee.json"
		line wait "$(message 'Validating the existing device pairing...' '正在验证已有设备配对…')"
		# Keep stdout live for unfinished web pairing. Replay stderr verbatim,
		# retaining the exact legacy diagnostic without parsing configuration JSON.
		if run_bee login --config "$config_path" 2>"$work/login-error"; then
			cat "$work/login-error" >&2
			return 0
		else
			login_status=$?
		fi
		cat "$work/login-error" >&2
		if ! grep -Fxq 'bound device credential is invalid; silent pairing is not allowed' "$work/login-error"; then
			failure "$login_status" "$(message '%s failed (exit %s); Bee configuration: %s' '%s 失败（退出码 %s）；Bee 配置：%s' 'bee login' "$login_status" "$config_path")"
		fi
		line warn "$(message 'Hive rejected the previous device pairing; the device may have been deleted or replaced.' 'Hive 已拒绝旧设备配对，设备可能已被删除或替换。')"
		message 'Re-pairing stops this Bee service and backs up the old device configuration. Your supplied accounts are kept.\nApproving a replacement in Hive may deactivate another Bee.\n' '重新配对会停止本机 Bee 服务并备份旧设备配置，保留供给账号选择。\n如果 Hive 已有另一台 Bee，在网页确认替换会停用那台设备。\n'
		if ! confirm "$(message 'Pair this device again? [y/N]:' '是否重新配对？[y/N]:')" no; then
			pairing_cancelled
			return 1
		fi
		repair_pairing=1
	fi
	while :; do
		message 'Hive address: ' '请输入 Hive 地址：'
		if ! IFS= read -r hive; then
			pairing_cancelled
			if [ "$repair_pairing" = 0 ]; then service_help; fi
			return 1
		fi
		[ -n "$hive" ] && break
		message 'Hive address must not be empty.\n' 'Hive 地址不能为空。\n'
	done
	if [ "$repair_pairing" = 1 ]; then
		command -v flock >/dev/null 2>&1 || fail "$(message 'flock was not found on PATH; install util-linux before re-pairing. Configuration was not moved.' 'PATH 中未找到 flock；请安装 util-linux 后重新配对。未移动配置。')"
		wizard_command 'systemctl stop tokhive-bee' as_root systemctl stop tokhive-bee
		backup_pairing || exit "$?"
	fi
	wizard_command 'bee login' run_bee login --config "$config_path" --hive "$hive"
}

service_wizard() {
	read_service_state
	case "$service_state" in
	active)
		rule
		line title "$(message 'Bee update installed' 'Bee 更新完成')"
		message 'Bee is already running. Restart to apply this installation.\nRestarting may interrupt current work.\n\n' 'Bee 当前正在运行，重启后将使用新程序。\n重启可能中断当前工作。\n\n'
		if ! confirm "$(message 'Restart Bee now? [y/N]:' '现在重启 Bee？[y/N]:')" no; then
			line success "$(message 'The current Bee process continues running.' '当前 Bee 继续运行。')"
			message 'Apply the update later: sudo systemctl restart tokhive-bee\n' '稍后应用更新：sudo systemctl restart tokhive-bee\n'
			service_status_help
			return 0
		fi
		wizard_command 'systemctl restart tokhive-bee' as_root systemctl restart tokhive-bee
		;;
	inactive | failed)
		message '\nComplete device pairing and account selection to run Bee in the background.\n' '\n接下来完成设备配对和账号选择，让 Bee 在后台运行。\n'
		if ! confirm "$(message 'Set up and start Bee now? [Y/n]:' '现在配置并启动 Bee？[Y/n]:')" yes; then
			line warn "$(message 'Installation kept. Bee was not started by this wizard.' '安装已保留，本次向导尚未启动 Bee。')"
			service_help
			return 0
		fi
		step 1 "$(message 'Pair with Hive' '设备配对')"
		if ! pair_device; then return 0; fi
		[ -f "$config_path" ] || fail "$(message 'bee login returned success but %s is missing; service was not started' 'bee login 返回成功，但配置 %s 不存在；尚未启动服务' "$config_path")"
		step 2 "$(message 'Configure supplied accounts' '配置供给账号')"
		if [ ! -f "$egress_path" ]; then
			wizard_command 'bee setup' run_bee setup --config "$config_path" --egress-config "$egress_path"
		else
			line success "$(message 'Using the existing supply configuration; no account selection needed.' '使用已有供给配置，无需重新选择账号。')"
		fi
		[ -f "$egress_path" ] || fail "$(message 'bee setup returned success but %s is missing; service was not started' 'bee setup 返回成功，但配置 %s 不存在；尚未启动服务' "$egress_path")"
		step 3 "$(message 'Start Bee' '启动 Bee')"
		line wait "$(message 'Starting the background service...' '正在启动后台服务…')"
		wizard_command 'systemctl start tokhive-bee' as_root systemctl start tokhive-bee
		;;
	activating | reloading | deactivating)
		line warn "$(message 'Bee service is %s; leaving the current process in place.' 'Bee 服务当前状态为 %s，保留现有进程。' "$service_state")"
		service_status_help
		return 0
		;;
	*) fail "$(message 'tokhive-bee ActiveState=%s; expected active, inactive, failed, activating, reloading, or deactivating' 'tokhive-bee ActiveState=%s；允许状态为 active、inactive、failed、activating、reloading 或 deactivating' "$service_state")" ;;
	esac
	line wait "$(message 'Checking service state...' '正在检查服务运行状态…')"
	read_service_state
	[ "$service_state" = active ] || fail "$(message 'tokhive-bee ActiveState=%s after service operation; expected active' '服务操作后 tokhive-bee ActiveState=%s；期望状态为 active' "$service_state")"
	line success "$(message 'Bee service is active.' '后台服务已启动。')"
	rule major
	line 'done' "$(message 'Bee is running in the background' 'Bee 已在后台运行')"
	message '\nBoot startup: enabled\nYou can disconnect SSH; Bee will keep running.\n' '\n开机自启：已启用\n现在可以退出 SSH，Bee 会继续运行。\n'
	service_status_help
	rule major
}

# Environment= and ExecStart= have different dollar expansion rules. Both
# accept quoted strings and percent specifiers; none of these values is a shell
# command. Refuse line breaks so an environment value cannot add unit settings.
single_line() {
	carriage_return=$(printf '\r')
	case "$2" in
	*"$carriage_return"* | *'
'*) fail "$(message '%s contains a line break; systemd settings must occupy one line' '%s 包含换行；systemd 配置值必须为单行' "$1")" ;;
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
	[ "$os" = linux ] || fail "$(message 'systemd service installation requires Linux; detected %s' '安装 systemd 服务需要 Linux；当前为 %s' "$os")"
	install_uid=$(id -u)
	install_user=$(id -un)
	if [ "$install_uid" = 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
		fail "$(message 'installer is running as root via sudo for %s; run it as %s without sudo so Bee uses that user\047s configuration' '安装脚本通过 sudo 以 root 运行，原用户为 %s；请以 %s 直接运行脚本，不要对整个脚本使用 sudo' "$SUDO_USER" "$SUDO_USER")"
	fi
	config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
	case "$HOME" in
	/*) ;;
	*) fail "$(message 'HOME=%s; systemd service installation requires an absolute home directory' 'HOME=%s；安装 systemd 服务需要绝对路径的主目录' "$HOME")" ;;
	esac
	case "$config_home" in
	/*) ;;
	*) fail "$(message 'XDG_CONFIG_HOME=%s; Bee requires an absolute configuration directory' 'XDG_CONFIG_HOME=%s；Bee 配置目录必须为绝对路径' "$config_home")" ;;
	esac
	single_line HOME "$HOME"
	single_line BEE_INSTALL_DIR "$directory"
	single_line XDG_CONFIG_HOME "$config_home"
	single_line PATH "$PATH"
	codex_environment=$(optional_environment CODEX_HOME "${CODEX_HOME+x}" "${CODEX_HOME-}")
	claude_environment=$(optional_environment CLAUDE_CONFIG_DIR "${CLAUDE_CONFIG_DIR+x}" "${CLAUDE_CONFIG_DIR-}")
	claude_secure_environment=$(optional_environment CLAUDE_SECURESTORAGE_CONFIG_DIR "${CLAUDE_SECURESTORAGE_CONFIG_DIR+x}" "${CLAUDE_SECURESTORAGE_CONFIG_DIR-}")
	command -v systemctl >/dev/null 2>&1 || fail "$(message 'systemctl was not found on PATH; set BEE_INSTALL_SERVICE=0 to install only the binary' 'PATH 中未找到 systemctl；设置 BEE_INSTALL_SERVICE=0 可仅安装程序')"
	systemctl show-environment >/dev/null || fail "$(message 'systemctl show-environment failed; a running system systemd manager is required (set BEE_INSTALL_SERVICE=0 for binary-only installation)' 'systemctl show-environment 失败；需要运行中的系统级 systemd（设置 BEE_INSTALL_SERVICE=0 可仅安装程序）')"
	if [ "$install_uid" != 0 ]; then
		command -v sudo >/dev/null 2>&1 || fail "$(message 'sudo was not found on PATH for user %s; system service installation needs administrator access (set BEE_INSTALL_SERVICE=0 for binary-only installation)' '用户 %s 的 PATH 中未找到 sudo；安装系统服务需要管理员权限（设置 BEE_INSTALL_SERVICE=0 可仅安装程序）' "$install_user")"
		# Validate a regular command: sudo -v can require a password even when
		# NOPASSWD permits every command, due to other matching sudoers entries.
		sudo true || fail "$(message 'sudo true failed for %s while preparing %s' 'sudo true 失败；用户为 %s，待安装服务路径为 %s' "$install_user" "$service_path")"
	fi
	if as_root test -L "$service_path"; then
		fail "$(message '%s is a symbolic link; remove or migrate the existing service before installing Bee\047s managed service' '%s 是符号链接；请先移除或迁移现有服务，再安装 Bee 托管的服务' "$service_path")"
	fi
	if as_root test -e "$service_path" && ! as_root grep -Fxq "$service_marker" "$service_path"; then
		fail "$(message '%s already exists and is not managed by this installer; migrate it first, or set BEE_INSTALL_SERVICE=0 to keep it' '%s 已存在且不由安装器管理；请先迁移，或设置 BEE_INSTALL_SERVICE=0 保留现有服务' "$service_path")"
	fi
	if systemctl --user is-enabled --quiet tokhive-bee 2>/dev/null || systemctl --user is-active --quiet tokhive-bee 2>/dev/null; then
		fail "$(message 'user-level tokhive-bee is enabled or active for %s; run \047systemctl --user disable --now tokhive-bee\047 before installing the system service' '用户 %s 的用户级 tokhive-bee 已启用或正在运行；请先执行 systemctl --user disable --now tokhive-bee，再安装系统服务' "$install_user")"
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
	fail "$(message 'need sha256sum or shasum to verify the download' '未找到 sha256sum 或 shasum，无法校验下载文件')"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
line wait "$(message 'Downloading %s' '正在下载 %s' "$base/$archive")"
curl -fsSL -o "$work/$archive" "$base/$archive" || fail "$(message 'download failed: %s' '下载失败：%s' "$base/$archive")"
curl -fsSL -o "$work/checksums.txt" "$base/checksums.txt" || fail "$(message 'checksum download failed: %s' '校验清单下载失败：%s' "$base/checksums.txt")"
expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$work/checksums.txt")
[ -n "$expected" ] || fail "$(message '%s is not listed in checksums.txt' 'checksums.txt 中未列出 %s' "$archive")"
[ "$(sha256 "$work/$archive")" = "$expected" ] || fail "$(message 'checksum mismatch for %s' '%s 的校验和不匹配' "$archive")"

tar -xzf "$work/$archive" -C "$work" bee
mkdir -p "$directory"
# Replace through a rename, so a running bee keeps its old file.
cp "$work/bee" "$directory/.bee.new"
chmod 755 "$directory/.bee.new"
mv -f "$directory/.bee.new" "$directory/bee"
installed=1
line success "$(message 'Installed %s to %s' '程序已安装：%s，路径：%s' "$("$directory/bee" version)" "$directory/bee")"

case ":$PATH:" in
*":$directory:"*) ;;
*) message 'Add the installation directory to PATH: export PATH=%s\n' '将安装目录加入 PATH：export PATH=%s\n' "$(shell_quote "$directory"):\$PATH" ;;
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
	as_root install -m 644 "$work/tokhive-bee.service" "$service_path" || fail "$(message 'could not install %s for user %s' '无法安装 %s，运行用户为 %s' "$service_path" "$install_user")"
	as_root systemctl daemon-reload || fail "$(message 'systemctl daemon-reload failed after installing %s' '安装 %s 后 systemctl daemon-reload 失败' "$service_path")"
	as_root systemctl enable tokhive-bee || fail "$(message 'systemctl enable tokhive-bee failed for %s' 'systemctl enable tokhive-bee 失败，服务文件为 %s' "$service_path")"
	line success "$(message 'Enabled tokhive-bee at boot, running as %s without an SSH login.' '已设置开机自启，以 %s 身份运行，无需 SSH 登录。' "$install_user")"
	# The script's stdin may still contain curl's script body.
	if [ "$interactive" = 1 ] && [ "$can_prompt" = 1 ]; then
		service_wizard </dev/tty
	else
		service_help
	fi
else
	message 'Start Bee and complete setup: %s start\n' '运行 Bee 并完成配置：%s start\n' "$(shell_quote "$directory/bee")"
fi
