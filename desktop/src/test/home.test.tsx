import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { claude, fakeShell, overview, platform, refuse, snapshot } from "./fakeShell";
import type { Snapshot } from "../lib/bee";

function show(first: Snapshot, settings = {}) {
  const shell = fakeShell(first, settings);
  render(<App shell={shell} />);
  return shell;
}

const card = (name: RegExp) => screen.getByRole("article", { name });

describe("account conclusions", () => {
  it("shows both accounts sharing, grouped by platform, without credentials", async () => {
    show(snapshot());
    expect(await screen.findByRole("heading", { name: "2 个账号都在共享" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "ChatGPT（Codex）" })).toBeInTheDocument();
    const c = card(/Claude/);
    expect(within(c).getByText("共享中")).toBeInTheDocument();
    expect(within(c).getByText("b***@gmail.com")).toBeInTheDocument();
    expect(within(c).getByText("3f9a12c0")).toBeInTheDocument();
    expect(within(c).getByText("Max")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "暂停共享" })).toBeInTheDocument();
    expect(within(c).getByText("额度 · 到点自动重置")).toBeInTheDocument();
    expect(within(c).getByRole("progressbar", { name: "5 小时" })).toHaveAttribute("aria-valuenow", "42");
    expect(document.body.textContent).not.toContain("b.lee@gmail.com");
  });

  it("syncing: says what it waits for and shows no quota yet", async () => {
    show(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: platform("syncing", "capabilities_unknown") } }));
    const c = await screen.findByRole("article", { name: /Claude/ });
    expect(within(c).getByText("正在同步")).toBeInTheDocument();
    expect(within(c).getByText(/通常需要 1 到 3 分钟/)).toBeInTheDocument();
    expect(within(c).getByText("额度 · 暂无数据")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 个正在同步" })).toBeInTheDocument();
  });

  it("an account not read from Hive yet counts as syncing", async () => {
    show(snapshot({ platforms: { openai: platform("sharing") } }));
    const c = await screen.findByRole("article", { name: /Claude/ });
    expect(within(c).getByText("正在同步")).toBeInTheDocument();
  });

  it("paused: offers to start sharing", async () => {
    show(snapshot({ platforms: { claude: platform("paused", "manually_paused"), openai: platform("paused", "manually_paused") } }));
    expect(await screen.findByRole("heading", { name: "所有共享已暂停" })).toBeInTheDocument();
    const c = card(/Claude/);
    expect(within(c).getByText("已暂停")).toBeInTheDocument();
    expect(within(c).getByText("你暂停了共享，这个账号不会接新的请求。")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "开始共享" })).toBeInTheDocument();
  });

  it("quota used up: marks the window and says when it resets", async () => {
    const windows = [
      { seconds: 18000, used_percent: 10, reset_at: new Date(Date.now() + 3600e3).toISOString() },
      { seconds: 604800, used_percent: 100, reset_at: new Date(Date.now() + 3 * 86400e3).toISOString() },
    ];
    show(snapshot({ platforms: { claude: platform("sharing"), openai: platform("waiting", "quota_exhausted", { windows }) } }));
    const c = await screen.findByRole("article", { name: /ChatGPT/ });
    expect(within(c).getByText("暂时不能接单")).toBeInTheDocument();
    expect(within(c).getByText(/^本周额度已用完，周. \d\d:\d\d 重置后自动恢复共享。$/)).toBeInTheDocument();
    expect(within(c).getByText("100%")).toHaveClass("text-bad");
    expect(screen.getByRole("heading", { name: "1 个共享中，1 个暂时不能接单" })).toBeInTheDocument();
  });

  it("waiting for other reasons: Bee's cause and that it recovers", async () => {
    show(snapshot({ platforms: { claude: platform("waiting", "rate_limited"), openai: platform("offline", "offline") } }));
    expect(await within(await screen.findByRole("article", { name: /Claude/ })).findByText("平台正在限制这个账号的使用频率。")).toBeInTheDocument();
    expect(within(card(/ChatGPT/)).getByText("TokHive 现在连不上这台电脑。")).toBeInTheDocument();
  });

  it("missing quota windows say there is no data", async () => {
    show(snapshot({ platforms: { claude: platform("sharing", undefined, { windows: [] }), openai: platform("sharing", undefined, { windows: [{ seconds: 18000, used_percent: null }] }) } }));
    expect(await within(await screen.findByRole("article", { name: /Claude/ })).findByText("额度 · 暂无数据")).toBeInTheDocument();
    expect(within(card(/ChatGPT/)).getByText("暂无数据")).toBeInTheDocument();
  });

  it("old quota data says when it was read", async () => {
    show(snapshot({ platforms: { claude: platform("sharing", undefined, { observed_at: new Date(Date.now() - 40 * 60e3).toISOString() }), openai: platform("sharing") } }));
    expect(await within(await screen.findByRole("article", { name: /Claude/ })).findByText(/更新于 40 分钟前/)).toBeInTheDocument();
  });

  it("sign-in expired here: how to sign in again, and check again", async () => {
    const shell = show(snapshot({ platforms: { claude: platform("action", "claude_authorization_rejected"), openai: platform("sharing") } }));
    const c = await screen.findByRole("article", { name: /Claude/ });
    expect(within(c).getByText("需要你处理")).toBeInTheDocument();
    expect(within(c).getByText("Claude 拒绝了这个账号的授权，通常是登录已失效。")).toBeInTheDocument();
    expect(within(c).getByText("claude")).toBeInTheDocument();
    shell.answer(() => ({ platform: "claude", available: false, problem: { code: "BEE-CLAUDE-SOURCE", message: "" } }));
    await userEvent.click(within(c).getByRole("button", { name: "我已重新登录，重新检测" }));
    expect(await within(c).findByRole("alert")).toHaveTextContent("仍然无法读取登录，请确认已在官方客户端重新登录。");
    expect(screen.getByRole("heading", { name: "1 个账号需要你处理" })).toBeInTheDocument();
  });

  it("imported sign-in expired: import the file again", async () => {
    show(snapshot({ platforms: { claude: platform("sharing"), openai: platform("action", "codex_authorization_rejected") } }));
    const c = await screen.findByRole("article", { name: /ChatGPT/ });
    expect(within(c).getByText(/在导出文件的那台电脑上重新登录/)).toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "重新导入凭证文件" }));
    expect(await screen.findByRole("heading", { name: "导入 ChatGPT 凭证文件" })).toBeInTheDocument();
  });

  it("client switched accounts: names the new one and confirms the switch", async () => {
    const shell = show(snapshot({ platforms: { claude: platform("action", "claude_confirmation_required"), openai: platform("sharing") } }));
    shell.answer((method, path) => {
      if (path === "/v1/platforms/claude/login") return { platform: "claude", available: true, email: "d.kim@gmail.com", fingerprint: "5b20" };
      if (method === "POST" && path === "/v1/accounts/acc_claude/confirm") return {};
    });
    const c = await screen.findByRole("article", { name: /Claude/ });
    expect(await within(c).findByText("检测到 Claude Code 现在登录的是 d***@gmail.com，和之前共享的 b***@gmail.com 不同。")).toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "改用新账号" }));
    await waitFor(() => expect(shell.calls.some((c) => c.path === "/v1/accounts/acc_claude/confirm")).toBe(true));
    expect(await screen.findByText("已改用新账号")).toBeInTheDocument();
  });

  it("account used by someone else: offers to remove it", async () => {
    show(snapshot({ platforms: { claude: platform("sharing"), openai: platform("action", "codex_account_in_use") } }));
    const c = await screen.findByRole("article", { name: /ChatGPT/ });
    expect(within(c).getByText("这个 ChatGPT 账号已被另一个 TokHive 账号使用。")).toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "删除这个账号" }));
    expect(await screen.findByRole("dialog", { name: "删除 ChatGPT 账号？" })).toBeInTheDocument();
  });

  it("restricted: contact support with the account number", async () => {
    const shell = show(snapshot({ platforms: { claude: platform("sharing"), openai: platform("restricted", "banned") } }));
    const c = await screen.findByRole("article", { name: /ChatGPT/ });
    expect(within(c).getByText("平台限制")).toBeInTheDocument();
    expect(within(c).getByText("TokHive 暂停了这个账号的共享。")).toBeInTheDocument();
    expect(within(c).queryByRole("button", { name: "暂停共享" })).not.toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "复制编号" }));
    expect(shell.copy).toHaveBeenCalledWith("81d0e7aa");
    expect(within(c).getByText("技术详情")).toBeInTheDocument();
  });

  it("syncing for over ten minutes asks the person to look", async () => {
    const shell = show(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: platform("syncing", "capabilities_unknown") } }));
    await screen.findByRole("article", { name: /Claude/ });
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60e3;
    try {
      shell.push(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: platform("syncing", "capabilities_unknown") } }));
      const c = await screen.findByRole("article", { name: /Claude/ });
      expect(await within(c).findByText(/同步时间比平时长/)).toBeInTheDocument();
      expect(within(c).getByText("需要你处理")).toBeInTheDocument();
      await userEvent.click(within(c).getByRole("button", { name: "导出诊断报告" }));
      expect(shell.exportDiagnostics).toHaveBeenCalled();
    } finally {
      Date.now = realNow;
    }
  });

  it("the account number term explains itself on focus", async () => {
    show(snapshot());
    const c = await screen.findByRole("article", { name: /Claude/ });
    const term = within(c).getByRole("button", { name: "编号" });
    term.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("用于联系客服时核对账号，不是密码，可以放心提供。");
  });

  it("no accounts: an empty state with a big add button", async () => {
    show(snapshot({ overview: overview({ accounts: undefined }), platforms: {} }));
    expect(await screen.findByRole("heading", { name: "还没有添加 AI 账号" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ 添加 AI 账号" }));
    expect(await screen.findByRole("heading", { name: "添加 AI 账号" })).toBeInTheDocument();
  });
});

describe("pause, resume, remove", () => {
  async function pauseClaude() {
    const c = await screen.findByRole("article", { name: /Claude/ });
    await userEvent.click(within(c).getByRole("button", { name: "暂停共享" }));
    return c;
  }

  it("pausing waits for Bee and then shows the paused card", async () => {
    const shell = show(snapshot());
    shell.answer(() => ({ paused: true }));
    const c = await pauseClaude();
    expect(shell.calls).toContainEqual({ method: "PUT", path: "/v1/platforms/claude/supply", body: { paused: true } });
    expect(within(c).getByRole("button", { name: /正在暂停/ })).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText("已暂停共享。正在处理的请求会正常完成。")).toBeInTheDocument();
    shell.push(snapshot({ platforms: { claude: platform("paused", "manually_paused"), openai: platform("sharing") } }));
    expect(await within(c).findByRole("button", { name: "开始共享" })).toBeInTheDocument();
  });

  it("a pause Hive did not confirm leaves the card as it was and can be retried", async () => {
    const shell = show(snapshot());
    shell.answer(() => refuse(502, "supply_unconfirmed"));
    const c = await pauseClaude();
    expect(await within(c).findByRole("alert")).toHaveTextContent("暂停失败：TokHive 没有确认这次操作，共享状态保持不变。");
    expect(within(c).getByText("共享中")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "暂停共享" })).toBeInTheDocument();
    shell.answer(() => ({ paused: true }));
    await userEvent.click(within(c).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(within(c).queryByRole("alert")).not.toBeInTheDocument());
    expect(shell.calls.filter((call) => call.method === "PUT")).toHaveLength(2);
  });

  it("a resume that cannot reach the background service says so", async () => {
    const shell = show(snapshot({ platforms: { claude: platform("paused", "manually_paused"), openai: platform("sharing") } }));
    shell.answer(() => refuse(0, "unreachable"));
    const c = await screen.findByRole("article", { name: /Claude/ });
    await userEvent.click(within(c).getByRole("button", { name: "开始共享" }));
    expect(await within(c).findByRole("alert")).toHaveTextContent("恢复失败：无法连接后台服务，状态未改变。");
    expect(within(c).getByText("已暂停")).toBeInTheDocument();
  });

  it("removing asks first, then removes", async () => {
    const shell = show(snapshot());
    shell.answer(() => ({ removed: "acc_claude" }));
    const c = await screen.findByRole("article", { name: /Claude/ });
    await userEvent.click(within(c).getByRole("button", { name: "更多操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "删除账号" }));
    const dialog = await screen.findByRole("dialog", { name: "删除 Claude 账号？" });
    expect(within(dialog).getByText("删除后，这台电脑将不再共享 b***@gmail.com。")).toBeInTheDocument();
    expect(within(dialog).getByText("不会退出你在 Claude Code 里的登录。")).toBeInTheDocument();
    expect(within(dialog).getByText("账号仍归属于你的 TokHive 账号，其他人无法添加。")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(shell.calls).toContainEqual({ method: "DELETE", path: "/v1/accounts/acc_claude", body: undefined });
    expect(await screen.findByText("已删除 Claude 账号")).toBeInTheDocument();
  });

  it("removing an imported account says its copy goes too; a failure keeps it", async () => {
    const shell = show(snapshot());
    shell.answer(() => refuse(502, "pause_unconfirmed"));
    const c = await screen.findByRole("article", { name: /ChatGPT/ });
    await userEvent.click(within(c).getByRole("button", { name: "更多操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "删除账号" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("应用保存的凭证副本也会被删除。")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("删除失败：TokHive 没有确认暂停，所以什么都没变。");
    expect(within(dialog).getByRole("button", { name: "重试" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(card(/ChatGPT/)).toBeInTheDocument();
  });

  it("a switch Hive did not confirm keeps the card and says why", async () => {
    const shell = show(snapshot({ platforms: { claude: platform("action", "claude_confirmation_required"), openai: platform("sharing") } }));
    shell.answer((method) => (method === "POST" ? refuse(502, "confirmation_unconfirmed") : { available: false }));
    const c = await screen.findByRole("article", { name: /Claude/ });
    await userEvent.click(within(c).getByRole("button", { name: "改用新账号" }));
    expect(await within(c).findByRole("alert")).toHaveTextContent("切换失败：TokHive 没有确认换号。");
  });

  it("the menu works from the keyboard", async () => {
    show(snapshot());
    const c = await screen.findByRole("article", { name: /Claude/ });
    within(c).getByRole("button", { name: "更多操作" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("dialog", { name: "删除 Claude 账号？" })).toBeInTheDocument();
  });
});

describe("global banners", () => {
  it("background service not running: retry and export diagnostics", async () => {
    const shell = show(snapshot({ service: "stopped", overview: null, platforms: {} }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Bee 后台服务没有运行，暂时无法共享。");
    expect(screen.getByRole("heading", { name: "暂时无法显示共享状态" })).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole("button", { name: "重试" }));
    expect(shell.retryService).toHaveBeenCalled();
    await userEvent.click(within(banner).getByRole("button", { name: "导出诊断" }));
    expect(await screen.findByText(/诊断报告已保存（已脱敏）/)).toBeInTheDocument();
    within(banner).getByRole("button", { name: "后台服务" }).focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/后台服务是 Bee 负责连接 TokHive/);
  });

  it("reconnecting: a warning, and cards without a conclusion", async () => {
    show(snapshot({ overview: overview({ connection: "connecting" }), platforms: {} }));
    expect(await screen.findByText("正在重新连接 TokHive…")).toBeInTheDocument();
    expect(screen.getByText("连接中")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "暂时无法显示共享状态" })).toBeInTheDocument();
    expect(within(card(/Claude/)).queryByText("共享中")).not.toBeInTheDocument();
  });

  it("replaced: link this computer again", async () => {
    show(snapshot({ overview: overview({ binding: "replaced", connection: "disconnected" }), platforms: {} }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("这台电脑已不再绑定：你的 TokHive 账号绑定了另一台电脑。");
    await userEvent.click(within(banner).getByRole("button", { name: "重新绑定这台电脑" }));
    expect(await screen.findByRole("heading", { name: "重新绑定这台电脑" })).toBeInTheDocument();
  });

  it("invalid link: says TokHive no longer accepts it", async () => {
    show(snapshot({ overview: overview({ binding: "invalid", connection: "disconnected" }), platforms: {} }));
    expect(await screen.findByRole("alert")).toHaveTextContent("TokHive 不再接受这台电脑的绑定");
  });

  it("run from the command line: a note, and accounts are managed there", async () => {
    show(
      snapshot({
        service: "external",
        overview: overview({ mode: "cli", accounts: undefined, sources: [{ name: "claude", platform: "claude" }] }),
        platforms: { claude: platform("sharing") },
      }),
    );
    expect(await screen.findByText(/Bee 正由命令行或系统服务在后台运行/)).toBeInTheDocument();
    expect(screen.getByText(/请在命令行中用 bee setup 添加或删除账号/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ 添加账号" })).not.toBeInTheDocument();
    const c = card(/Claude/);
    expect(within(c).getByRole("button", { name: "暂停共享" })).toBeInTheDocument();
    expect(within(c).queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
  });

  it("an older Bee holds the configuration: says so and offers the stop command", async () => {
    const shell = show(snapshot({ service: "stopped", overview: null, platforms: {}, occupied: { pid: 4821 } }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("这台电脑上有旧版命令行 Bee 正在运行（进程 4821），请先停止它。");
    expect(banner).not.toHaveTextContent("后台服务没有运行");
    await userEvent.click(within(banner).getByRole("button", { name: "复制停止命令" }));
    expect(shell.copy).toHaveBeenCalledWith("kill 4821");
    expect(await screen.findByText("停止命令已复制")).toBeInTheDocument();
  });

  it("an older Bee whose process is unknown has no command to copy", async () => {
    show(snapshot({ service: "stopped", overview: null, platforms: {}, occupied: { pid: null } }), { language: "en", resolved_language: "en" });
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("An older Bee run from the command line is running on this computer. Stop it first.");
    expect(within(banner).queryByRole("button", { name: /stop command/ })).not.toBeInTheDocument();
  });

  it("starting: waits for the background service", async () => {
    show(snapshot({ service: "starting", overview: null, platforms: {} }));
    expect(await screen.findByText("正在连接后台服务…")).toBeInTheDocument();
  });
});

describe("English", () => {
  it("shows the home page in English", async () => {
    show(snapshot({ platforms: { claude: platform("action", "claude_authorization_rejected"), openai: platform("paused", "manually_paused") } }), { language: "en", resolved_language: "en" });
    expect(await screen.findByRole("heading", { name: "1 account needs your attention" })).toBeInTheDocument();
    const c = card(/Claude/);
    expect(within(c).getByText("Needs your attention")).toBeInTheDocument();
    expect(within(c).getByText("Claude rejected this account's sign-in. It has usually expired.")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "I signed in again, check again" })).toBeInTheDocument();
    expect(within(card(/ChatGPT/)).getByRole("button", { name: "Start sharing" })).toBeInTheDocument();
    expect(screen.getByText("View earnings on the web ↗")).toBeInTheDocument();
  });

  it("joins Bee's cause and fix with a space in English", async () => {
    show(snapshot({ overview: overview({ accounts: [claude] }), platforms: { claude: platform("syncing", "capabilities_unknown") } }), { language: "en", resolved_language: "en" });
    const c = await screen.findByRole("article", { name: /Claude/ });
    expect(within(c).getByText("Bee is reading this account's models and quota. Nothing to do. It usually takes 1 to 3 minutes.")).toBeInTheDocument();
  });

  it("English failures read naturally", async () => {
    const shell = show(snapshot(), { language: "en", resolved_language: "en" });
    shell.answer(() => refuse(0, "unreachable"));
    const c = await screen.findByRole("article", { name: /Claude/ });
    await userEvent.click(within(c).getByRole("button", { name: "Pause sharing" }));
    expect(await within(c).findByRole("alert")).toHaveTextContent("Could not pause: Cannot reach the background service; nothing changed.");
  });
});
