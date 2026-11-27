import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { claude, codex, fakeShell, overview, platform, refuse, snapshot } from "./fakeShell";
import type { Pairing, Snapshot } from "../lib/bee";

function show(first: Snapshot, settings = {}) {
  const shell = fakeShell(first, settings);
  render(<App shell={shell} />);
  return shell;
}

/** Opens the shared accounts page from the sidebar. */
async function openAccounts() {
  await userEvent.click(await screen.findByRole("button", { name: "共享账号" }));
}

const unpaired = () => snapshot({ overview: overview({ binding: "unpaired", connection: "disconnected", device: null, accounts: undefined }), platforms: {} });

const pending: Pairing = {
  status: "pending",
  user_code: "ABCD-EFGH",
  verification_url: "https://console.tokhive.ai/devices/pair?code=ABCD-EFGH",
  expires_at: new Date(Date.now() + 10 * 60e3).toISOString(),
};

describe("first run and linking", () => {
  it("welcome → link → confirm in the browser → add the first account → done", async () => {
    const shell = show(unpaired());
    let status: Pairing = pending;
    shell.answer((method, path) => {
      if (path === "/v1/pairing") return method === "POST" ? pending : status;
      if (path === "/v1/platforms/claude/login") return { platform: "claude", available: true, email: "b.lee@gmail.com", plan: "max" };
      if (method === "POST" && path === "/v1/accounts") return claude;
    });
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    expect(screen.getByText("第 1 步 / 共 2 步")).toBeInTheDocument();
    expect(screen.getByText(/一个 TokHive 账号只能绑定一台电脑/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(shell.openUrl).toHaveBeenCalledWith(pending.verification_url);
    expect(screen.getByText(/后过期$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "复制链接" }));
    expect(shell.copy).toHaveBeenCalledWith(pending.verification_url);

    status = { status: "completed" };
    shell.push(snapshot({ overview: overview({ accounts: undefined }), platforms: {} }));
    expect(await screen.findByRole("heading", { name: "添加第一个 AI 账号" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("第 2 步 / 共 2 步")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Claude/ }));
    expect(await screen.findByText("✓ 检测到 Claude Code 已登录：b***@gmail.com · Max")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("heading", { name: "确认添加" })).toBeInTheDocument();
    expect(screen.getByText("添加后会立即开始共享，你可以随时暂停或删除。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "添加并开始共享" }));
    expect(shell.calls).toContainEqual({ method: "POST", path: "/v1/accounts", body: { platform: "claude", source: "local" } });
    shell.push(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: platform("syncing", "capabilities_unknown") } }));
    expect(await screen.findByRole("heading", { name: "已添加 Claude 账号，正在同步" })).toBeInTheDocument();
    expect(screen.getByText("已绑定到 a***@gmail.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "进入仪表盘" }));
    expect(await screen.findByRole("heading", { name: "仪表盘" })).toBeInTheDocument();
    await openAccounts();
    expect(await screen.findByRole("article", { name: /Claude/ })).toBeInTheDocument();
  });

  it("not now skips adding an account", async () => {
    const shell = show(unpaired());
    shell.answer((method, path) => (path === "/v1/pairing" ? (method === "POST" ? pending : { status: "completed" }) : {}));
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    await userEvent.click(await screen.findByRole("button", { name: "稍后再说" }, { timeout: 3000 }));
    expect(await screen.findByRole("heading", { name: "已绑定这台电脑" })).toBeInTheDocument();
  });

  it("cannot reach TokHive: says so and tries again", async () => {
    const shell = show(unpaired());
    shell.answer(() => refuse(502, "BEE-HIVE-UNREACHABLE"));
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法连接 TokHive，请检查网络后重试。");
    shell.answer((_method, path) => (path === "/v1/pairing" ? pending : {}));
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
  });

  it("an expired code can be renewed", async () => {
    const shell = show(unpaired());
    shell.answer((method) => (method === "POST" ? pending : { status: "expired" }));
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    expect(await screen.findByText("绑定码已过期，请重新获取。", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新获取" })).toBeInTheDocument();
  });

  it("a pairing TokHive ended says why", async () => {
    const shell = show(unpaired());
    shell.answer((method) => (method === "POST" ? pending : { status: "failed", problem: { code: "pairing_rejected", message: "" } }));
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("绑定在确认前就被 TokHive 结束了。");
  });

  it("cancel stops the pairing and goes back", async () => {
    const shell = show(unpaired());
    shell.answer(() => pending);
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    await screen.findByText("ABCD-EFGH");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(shell.calls).toContainEqual({ method: "DELETE", path: "/v1/pairing", body: undefined });
    expect(await screen.findByRole("heading", { name: "绑定 TokHive 账号" })).toBeInTheDocument();
  });

  it("a Bee that knows no Hive yet shows a hint and links without an address", async () => {
    const shell = show(snapshot({ overview: overview({ binding: "unpaired", connection: "disconnected", device: null, hive: "", accounts: undefined }), platforms: {} }));
    shell.answer(() => pending);
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByText("高级：更改服务地址"));
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveAttribute("placeholder", "留空使用 TokHive 官方服务");
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    await waitFor(() => expect(shell.calls).toContainEqual({ method: "POST", path: "/v1/pairing", body: {} }));
  });

  it("another service address is sent with the pairing", async () => {
    const shell = show(unpaired());
    shell.answer(() => pending);
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByText("高级：更改服务地址"));
    const input = screen.getByRole("textbox", { name: "服务地址" });
    await userEvent.clear(input);
    await userEvent.type(input, "https://hive.example.com");
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    await waitFor(() => expect(shell.calls).toContainEqual({ method: "POST", path: "/v1/pairing", body: { hive: "https://hive.example.com" } }));
  });

  it("switching TokHive account from settings keeps the current link until confirmed", async () => {
    const shell = show(snapshot());
    shell.answer((method) => (method === "POST" ? pending : { status: "completed" }));
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("button", { name: "切换账号" }));
    expect(screen.getByRole("heading", { name: "切换 TokHive 账号" })).toBeInTheDocument();
    expect(screen.getByText(/原账号的设备记录会留在 TokHive 网页上，显示为离线/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    expect(await screen.findByText("已切换到新的 TokHive 账号", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2 个账号都在共享" })).toBeInTheDocument();
  });
});

describe("the page that ends setup says what is true", () => {
  async function finish(state: ReturnType<typeof platform>) {
    const shell = show(unpaired());
    shell.answer((method, path) => {
      if (path === "/v1/pairing") return method === "POST" ? pending : { status: "completed" };
      if (path === "/v1/platforms/claude/login") return { platform: "claude", available: true, email: "b.lee@gmail.com", plan: "max" };
      if (method === "POST" && path === "/v1/accounts") return claude;
    });
    await userEvent.click(await screen.findByRole("button", { name: "开始" }));
    await userEvent.click(screen.getByRole("button", { name: "登录 TokHive 并绑定这台电脑" }));
    await userEvent.click(await screen.findByRole("button", { name: /Claude/ }, { timeout: 3000 }));
    await userEvent.click(await screen.findByRole("button", { name: "下一步" }));
    await userEvent.click(screen.getByRole("button", { name: "添加并开始共享" }));
    act(() => shell.push(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: state } })));
  }

  it("sharing", async () => {
    await finish(platform("sharing"));
    expect(await screen.findByRole("heading", { name: "已开始共享 Claude 账号" })).toBeInTheDocument();
  });

  it("an account that needs the person", async () => {
    await finish(platform("action", "claude_authorization_rejected"));
    expect(await screen.findByRole("heading", { name: "已添加 Claude 账号，但需要你处理" })).toBeInTheDocument();
  });

  it("an account that cannot take work for now", async () => {
    await finish(platform("waiting", "quota_exhausted"));
    expect(await screen.findByRole("heading", { name: "已添加 Claude 账号" })).toBeInTheDocument();
  });
});

describe("adding an account", () => {
  const onlyCodex = () => snapshot({ overview: overview({ accounts: [codex] }), platforms: { openai: platform("sharing") } });

  it("a platform that has an account cannot be chosen again", async () => {
    show(onlyCodex());
    await openAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "+ 添加账号" }));
    const taken = screen.getByRole("button", { name: /ChatGPT（Codex）/ });
    expect(taken).toHaveAttribute("aria-disabled", "true");
    expect(within(taken).getByText(/已添加 · 当前版本每个平台支持一个账号/)).toBeInTheDocument();
    await userEvent.click(taken);
    expect(screen.getByRole("heading", { name: "添加 AI 账号" })).toBeInTheDocument();
  });

  it("no sign-in here: steps to sign in, then check again", async () => {
    const shell = show(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: platform("sharing") } }));
    shell.answer(() => ({ platform: "openai", available: false, problem: { code: "BEE-SETUP-CODEX-NOT-FOUND", message: "" } }));
    await openAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "+ 添加账号" }));
    await userEvent.click(screen.getByRole("button", { name: /ChatGPT（Codex）/ }));
    expect(await screen.findByText("没有检测到 Codex 的登录。")).toBeInTheDocument();
    expect(screen.getByText("codex login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    shell.answer(() => ({ platform: "openai", available: true, email: "c.wu@outlook.com", plan: "plus" }));
    await userEvent.click(screen.getByRole("button", { name: "重新检测" }));
    expect(await screen.findByText("✓ 检测到 Codex 已登录：c***@outlook.com · Plus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("a sign-in found but unusable names what is wrong, and asks to sign in again, not to install", async () => {
    const shell = show(onlyCodex());
    shell.answer(() => ({
      platform: "claude",
      available: false,
      problem: { code: "BEE-CLAUDE-SOURCE", message: "", reason: { en: "Claude Code accessToken is empty", zh: "Claude Code 的 accessToken 为空" } },
    }));
    await openAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "+ 添加账号" }));
    await userEvent.click(screen.getByRole("button", { name: /Claude/ }));
    expect(await screen.findByText(/Bee 读到的 Claude Code 登录有问题：Claude Code 的 accessToken 为空/)).toBeInTheDocument();
    expect(screen.queryByText(/没有检测到 Claude Code 的登录/)).not.toBeInTheDocument();
    expect(screen.queryByText("安装 Claude Code")).not.toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("an expired sign-in is not offered, and says how to renew it", async () => {
    const shell = show(onlyCodex());
    shell.answer(() => ({ platform: "claude", available: false, problem: { code: "BEE-CLAUDE-EXPIRED", message: "" } }));
    await openAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "+ 添加账号" }));
    await userEvent.click(screen.getByRole("button", { name: /Claude/ }));
    expect(await screen.findByText(/Claude Code 的登录已经过期。打开一次 Claude Code，让它自动续期。/)).toBeInTheDocument();
    expect(screen.queryByText(/检测到 Claude Code 已登录/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新检测" })).toBeInTheDocument();
  });

  it("a sign-in that cannot be shared says why", async () => {
    const shell = show(onlyCodex());
    shell.answer(() => ({ platform: "claude", available: false, problem: { code: "login_scope", message: "" } }));
    await openAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "+ 添加账号" }));
    await userEvent.click(screen.getByRole("button", { name: /Claude/ }));
    expect(await screen.findByText(/这个 Claude Code 登录缺少共享所需的权限。/)).toBeInTheDocument();
  });

  it("a local account Bee refuses while adding keeps the confirm page with the reason", async () => {
    const shell = show(onlyCodex());
    shell.answer((method) => (method === "POST" ? refuse(422, "BEE-CLAUDE-EXPIRED") : { platform: "claude", available: true, email: "b.lee@gmail.com", plan: "max" }));
    await openAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "+ 添加账号" }));
    await userEvent.click(screen.getByRole("button", { name: /Claude/ }));
    await userEvent.click(await screen.findByRole("button", { name: "下一步" }));
    await userEvent.click(screen.getByRole("button", { name: "添加并开始共享" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Claude Code 的登录已经过期。打开一次 Claude Code，让它自动续期。");
    expect(screen.getByRole("heading", { name: "确认添加" })).toBeInTheDocument();
  });

  it("imports a credential file, and an invalid one says what is wrong", async () => {
    const shell = show(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: platform("sharing") } }));
    vi.mocked(shell.pickFile).mockResolvedValue("/home/a/config.toml");
    shell.answer((method) => (method === "POST" ? refuse(422, "import_invalid") : { available: false }));
    await openAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "+ 添加账号" }));
    await userEvent.click(screen.getByRole("button", { name: /ChatGPT（Codex）/ }));
    await userEvent.click(screen.getByRole("radio", { name: "导入凭证文件" }));
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("heading", { name: "导入 ChatGPT 凭证文件" })).toBeInTheDocument();
    expect(screen.getByText(/如果这个账号还在其他电脑或客户端上使用，其中一方可能会掉线/)).toBeInTheDocument();
    expect(screen.getByText("所有系统：用户目录下的 .codex/auth.json")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(screen.getByText("config.toml")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "添加并开始共享" }));
    expect(shell.calls).toContainEqual({ method: "POST", path: "/v1/accounts", body: { platform: "openai", source: "import", file: "/home/a/config.toml" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("config.toml · 这个文件不是这个平台可用的登录。Codex 用的是 auth.json，Claude Code 用的是 .credentials.json。请选择这个平台对应的文件。");
    expect(screen.getByRole("heading", { name: "导入 ChatGPT 凭证文件" })).toBeInTheDocument();

    shell.answer(() => codex);
    act(() => shell.drop("/home/a/.codex/auth.json"));
    expect(await screen.findByText("auth.json")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "添加并开始共享" }));
    expect(shell.calls.at(-1)).toEqual({ method: "POST", path: "/v1/accounts", body: { platform: "openai", source: "import", file: "/home/a/.codex/auth.json" } });
    act(() => shell.push(snapshot({ platforms: { claude: platform("sharing") } })));
    expect(await screen.findByRole("heading", { name: "1 个共享中，1 个正在同步" })).toBeInTheDocument();
  });

  it("importing again removes the old account first", async () => {
    const shell = show(snapshot({ platforms: { claude: platform("sharing"), openai: platform("action", "codex_authorization_rejected") } }));
    vi.mocked(shell.pickFile).mockResolvedValue("/home/a/auth.json");
    shell.answer(() => ({}));
    await openAccounts();
    await userEvent.click(await within(await screen.findByRole("article", { name: /ChatGPT/ })).findByRole("button", { name: "重新导入凭证文件" }));
    await userEvent.click(screen.getByRole("button", { name: "选择文件" }));
    await userEvent.click(screen.getByRole("button", { name: "添加并开始共享" }));
    await waitFor(() => expect(shell.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /v1/accounts/acc_codex", "POST /v1/accounts"]));
  });
});

describe("settings, about and quitting", () => {
  it("changes settings through the shell and switches language at once", async () => {
    const shell = show(snapshot());
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    const account = screen.getByRole("region", { name: "TokHive 账号" });
    expect(within(account).getByText("a***@gmail.com")).toBeInTheDocument();
    expect(within(account).getByText("https://console.tokhive.ai")).toBeInTheDocument();
    await userEvent.click(within(account).getByRole("button", { name: "复制" }));
    expect(shell.copy).toHaveBeenCalledWith("https://console.tokhive.ai");
    await userEvent.click(screen.getByRole("switch", { name: "开机自动启动" }));
    expect(shell.setSettings).toHaveBeenCalledWith({ autostart: false });
    await userEvent.click(screen.getByRole("switch", { name: "需要处理时发送通知" }));
    expect(shell.setSettings).toHaveBeenCalledWith({ notify: false });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "界面语言" }), "en");
    expect(shell.setSettings).toHaveBeenCalledWith({ language: "en" });
    expect(await screen.findByRole("switch", { name: "Start at login" })).not.toBeChecked();
    expect(screen.getByText("Bee 1.0.0")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Technical information"));
    expect(screen.getByText("1.2.3 · started by Bee")).toBeInTheDocument();
    expect(screen.getByText("/home/a/.config/tokhive/bee.json")).toBeInTheDocument();
    expect(screen.getByText("dev_1")).toBeInTheDocument();
  });

  it("opens the logs folder, shows where it is, and says when it cannot", async () => {
    const shell = show(snapshot());
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("button", { name: "打开日志文件夹" }));
    expect(shell.openLogs).toHaveBeenCalled();
    await userEvent.click(screen.getByText("技术信息"));
    expect(screen.getByText("/home/a/Library/Logs/ai.tokhive.bee")).toBeInTheDocument();
    vi.mocked(shell.openLogs).mockRejectedValue({ status: 500, code: "open_failed", message: "no" });
    await userEvent.click(screen.getByRole("button", { name: "打开日志文件夹" }));
    expect(await screen.findByText("无法打开日志文件夹")).toBeInTheDocument();
  });

  it("without a tray, keeping in the tray cannot be turned on and says why", async () => {
    show(snapshot(), { tray_available: false });
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    expect(screen.getByRole("switch", { name: /关闭窗口时留在/ })).toBeDisabled();
    expect(screen.getByText(/当前桌面不显示托盘图标/)).toBeInTheDocument();
  });

  it("exports diagnostics, and a failure says why", async () => {
    const shell = show(snapshot());
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("button", { name: "导出诊断报告" }));
    expect(await screen.findByText("诊断报告已保存（已脱敏）：/tmp/bee-diagnostics.json")).toBeInTheDocument();
    vi.mocked(shell.exportDiagnostics).mockRejectedValue({ status: 500, code: "save_failed", message: "denied" });
    await userEvent.click(screen.getByRole("button", { name: "导出诊断报告" }));
    expect(await screen.findByText(/^导出失败：/)).toBeInTheDocument();
  });

  it("the tray's quit asks first, since quitting stops sharing", async () => {
    const shell = show(snapshot());
    await screen.findByRole("heading", { name: "仪表盘" });
    act(() => shell.requestQuit());
    const dialog = await screen.findByRole("dialog", { name: "退出后将停止共享" });
    expect(within(dialog).getByText("正在处理的请求会先完成。")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(shell.quit).not.toHaveBeenCalled();
    act(() => shell.requestQuit());
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "退出" }));
    expect(shell.quit).toHaveBeenCalled();
  });

  it("opens earnings on the web", async () => {
    const shell = show(snapshot());
    await userEvent.click(await screen.findByRole("button", { name: "在网页查看收益 ↗" }));
    expect(shell.openUrl).toHaveBeenCalledWith("https://console.tokhive.ai/earnings");
  });
});
