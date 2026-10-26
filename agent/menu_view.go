package bee

import (
	"fmt"
	"strings"
)

// Rendering stays local to the menu; CLI commands and redirected output keep
// their existing formats. Color never carries meaning without a text label.
func (m *managementMenu) styled(code, text string) string {
	if !m.ui.color {
		return text
	}
	return "\x1b[" + code + "m" + text + "\x1b[0m"
}
func (m *managementMenu) page(title string) {
	heading := m.text("Bee management", "Bee 管理")
	if title != "" {
		heading = "Bee › " + title
	}
	if m.ui.terminal {
		heading = "🐝 " + heading
	}
	rule := "----------------------------------------"
	if m.ui.terminal {
		rule = "────────────────────────────────────────"
	}
	fmt.Fprintln(m.out, "\n"+m.styled("1;36", heading))
	fmt.Fprintln(m.out, m.styled("90", rule))
}
func (m *managementMenu) option(n int, label string) {
	fmt.Fprintf(m.out, "  %s  %s\n", m.styled("36", fmt.Sprint(n)), label)
}
func (m *managementMenu) field(en, zh, value string) {
	if value == "" {
		value = "—"
	}
	fmt.Fprintf(m.out, "  %s  %s\n", m.styled("90", m.text(en, zh)), value)
}
func (m *managementMenu) note(en, zh string) {
	fmt.Fprintln(m.out, "  "+m.text(en, zh))
}
func (m *managementMenu) next(step string) {
	if step == "" {
		return
	}
	fmt.Fprintln(m.out, "  "+m.styled("36", m.text("Next: ", "下一步："))+step)
}
func (m *managementMenu) details(detail string) {
	if detail == "" {
		return
	}
	fmt.Fprintln(m.out, "  "+m.styled("90", m.text("Technical details (original):", "技术详情（原文）：")))
	for _, line := range strings.Split(detail, "\n") {
		fmt.Fprintln(m.out, "    "+line)
	}
}
func (m *managementMenu) back() error { m.navigation++; return nil }
func (m *managementMenu) yesNo(value bool) string {
	if value {
		return m.text("Yes", "是")
	}
	return m.text("No", "否")
}
func platformName(p string) string {
	switch p {
	case "openai":
		return "OpenAI (Codex)"
	case "claude":
		return "Claude Code"
	}
	return p
}
