//go:build darwin || linux

package bee

const privateFilePermissionFix = "ensure the user running Bee owns the file; run chmod 600 on it so only that user can access it"
