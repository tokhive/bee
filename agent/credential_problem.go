package bee

// A credentialError describes one failed check without storing raw credential
// content. Paths, file modes, lengths and expiry values are safe evidence.
type credentialError struct {
	kind, detail string
	cause        error
}
type bilingualText struct{ en, zh string }

var credentialProblems = map[string]bilingualText{
	"missing":       {"Official credential file does not exist", "官方登录文件不存在"},
	"regular":       {"Official credential must be a regular file", "官方登录文件必须是普通文件"},
	"read":          {"Cannot read the official credential file", "无法读取官方登录文件"},
	"size":          {"Official credential exceeds 64 KiB", "官方登录信息超过 64 KiB"},
	"json":          {"Claude Code authorization has invalid JSON syntax", "Claude Code 登录信息的 JSON 语法不正确"},
	"json_type":     {"Claude Code authorization has an invalid JSON field type", "Claude Code 登录信息的 JSON 字段类型不正确"},
	"oauth":         {"Claude Code authorization is missing claudeAiOauth", "Claude Code 登录信息缺少 claudeAiOauth"},
	"token_missing": {"Claude Code accessToken is empty", "Claude Code 的 accessToken 为空"},
	"token_format":  {"Claude Code accessToken has an invalid format", "Claude Code 的 accessToken 格式不正确"},
	"expiry":        {"Claude Code expiresAt must be milliseconds in 1..253402300799999", "Claude Code 的 expiresAt 必须是 1 至 253402300799999 范围内的毫秒时间戳"},
}

func (e *credentialError) Error() string {
	text := credentialProblems[e.kind].en
	if e.detail != "" {
		text += ": " + e.detail
	}
	if e.cause != nil {
		text += ": " + e.cause.Error()
	}
	return text
}
func (e *credentialError) Unwrap() error { return e.cause }
