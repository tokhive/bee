//go:build windows

package bee

const privateFilePermissionFix = "open the file's Properties > Security > Advanced; set Owner to the account running Bee, disable inheritance, remove all permission entries except that account, and grant it Full control; then retry Bee"
