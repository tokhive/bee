import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { parseLine } from "../screens/Logs";
import { claude, codex, fakeShell, overview, platform, snapshot } from "./fakeShell";
import type { Settings, Snapshot } from "../lib/bee";

function show(first: Snapshot, settings: Partial<Settings> = {}) {
  const shell = fakeShell(first, settings);
  render(<App shell={shell} />);
  return shell;
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("the dashboard", () => {
  it("opens first and says who is linked, the connection and how many accounts share", async () => {
    show(snapshot({ platforms: { claude: platform("sharing"), openai: platform("action", "codex_authorization_rejected") } }));
    expect(await screen.findByRole("heading", { name: "仪表盘" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(within(main).getByText("a***@gmail.com")).toBeInTheDocument();
    expect(within(main).getByText("已连接")).toBeInTheDocument();
    expect(within(main).getByText("1 个在共享")).toBeInTheDocument();
    expect(within(main).getByText(/1 个待处理/)).toBeInTheDocument();
    await userEvent.click(within(main).getByRole("button", { name: /共享账号/ }));
    expect(await screen.findByRole("article", { name: /Claude/ })).toBeInTheDocument();
  });

  it("with no accounts, the accounts card adds the first one", async () => {
    show(snapshot({ overview: overview({ accounts: [] }), platforms: {} }));
    await screen.findByRole("heading", { name: "仪表盘" });
    const main = screen.getByRole("main");
    expect(await within(main).findByText("还没有账号")).toBeInTheDocument();
    await userEvent.click(within(main).getByRole("button", { name: /共享账号/ }));
    expect(await screen.findByRole("heading", { name: "添加 AI 账号" })).toBeInTheDocument();
  });

  it("says when Bee is reconnecting", async () => {
    show(snapshot({ overview: overview({ connection: "connecting" }) }));
    await screen.findByRole("heading", { name: "仪表盘" });
    const main = screen.getByRole("main");
    expect(await within(main).findByText("正在连接 TokHive")).toBeInTheDocument();
  });
});

describe("the sidebar", () => {
  it("lists the pages, marks the current one and counts sharing accounts", async () => {
    show(snapshot());
    const nav = await screen.findByRole("navigation", { name: "页面" });
    expect(within(nav).getByRole("button", { name: "仪表盘" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "共享账号" })).toHaveAccessibleDescription("2/2 个在共享");
    await userEvent.click(within(nav).getByRole("button", { name: "日志" }));
    expect(within(nav).getByRole("button", { name: "日志" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: "日志" })).toBeInTheDocument();
  });

  it("marks an account that needs the person", async () => {
    show(snapshot({ platforms: { claude: platform("action", "claude_authorization_rejected"), openai: platform("sharing") } }));
    const nav = await screen.findByRole("navigation", { name: "页面" });
    expect(within(nav).getByRole("button", { name: "共享账号" })).toHaveAccessibleDescription("有账号需要处理");
  });

  it("collapses to icons and remembers it", async () => {
    const shell = show(snapshot());
    await userEvent.click(await screen.findByRole("button", { name: "收起侧边栏" }));
    expect(shell.setSettings).toHaveBeenCalledWith({ sidebar_collapsed: true });
    expect(await screen.findByRole("button", { name: "展开侧边栏" })).toBeInTheDocument();
    // The pages keep their names for a screen reader.
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("follows the app menu's page items", async () => {
    const shell = show(snapshot());
    await screen.findByRole("heading", { name: "仪表盘" });
    act(() => shell.menu("settings"));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    act(() => shell.menu("accounts"));
    expect(await screen.findByRole("heading", { name: "共享账号" })).toBeInTheDocument();
  });
});

describe("appearance and keeping awake", () => {
  it("applies the colour mode at once and keeps it for the next start", async () => {
    const shell = show(snapshot());
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("radio", { name: "深色" }));
    expect(shell.setSettings).toHaveBeenCalledWith({ theme: "dark" });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(localStorage.getItem("bee-theme")).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "跟随系统" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
  });

  it("turns keeping the computer awake on, and says what it does", async () => {
    const shell = show(snapshot());
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    expect(screen.getByText(/合上笔记本盖子仍会休眠/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "防止电脑休眠" }));
    expect(shell.setSettings).toHaveBeenCalledWith({ prevent_sleep: true });
  });
});

describe("the log page", () => {
  const lines = [
    'time=2026-11-27T14:20:03.000+08:00 level=INFO msg="connected to hive" service=bee hive=https://console.tokhive.ai',
    'time=2026-11-27T14:24:30.000+08:00 level=WARN msg="quota window near limit" service=bee platform=claude used_percent=91',
    'time=2026-11-27T14:27:10.000+08:00 level=ERROR msg="token refresh failed" service=bee platform=claude status=400',
    "a line that is not structured",
  ];

  it("reads Bee's structured lines", () => {
    expect(parseLine(lines[1])).toMatchObject({ level: "WARN", message: "quota window near limit", rest: "platform=claude used_percent=91" });
    expect(parseLine(lines[3])).toMatchObject({ level: "", message: "a line that is not structured" });
  });

  it("shows the log, filters by level and searches", async () => {
    const shell = fakeShell(snapshot());
    shell.log = { ...shell.log, lines };
    render(<App shell={shell} />);
    await userEvent.click(await screen.findByRole("button", { name: "日志" }));
    const log = await screen.findByRole("log", { name: "日志" });
    expect(await within(log).findByText("connected to hive")).toBeInTheDocument();
    expect(screen.getByText("4 行")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "WARN" }));
    expect(within(log).queryByText("connected to hive")).not.toBeInTheDocument();
    expect(within(log).getByText("token refresh failed")).toBeInTheDocument();
    expect(screen.getByText("2 行")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "全部" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索日志" }), "refresh");
    expect(screen.getByText("1 行")).toBeInTheDocument();
    expect(within(log).getByText("refresh", { selector: "mark" })).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "搜索日志" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索日志" }), "nothing like this");
    expect(within(log).getByText("没有符合条件的日志。")).toBeInTheDocument();
  });

  it("says where the log is when Bee runs from the command line", async () => {
    const shell = fakeShell(snapshot({ service: "external", overview: overview({ mode: "cli", accounts: undefined, sources: [{ name: "claude", platform: "claude" }] }) }));
    shell.log = { ...shell.log, own: false };
    render(<App shell={shell} />);
    await userEvent.click(await screen.findByRole("button", { name: "日志" }));
    expect(await screen.findByText(/日志在它自己的输出里/)).toBeInTheDocument();
  });

  it("opens the folder and exports a report from the page", async () => {
    const shell = show(snapshot({ overview: overview({ accounts: [claude, codex] }) }));
    await userEvent.click(await screen.findByRole("button", { name: "日志" }));
    await userEvent.click(await screen.findByRole("button", { name: "打开日志文件夹" }));
    expect(shell.openLogs).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "导出诊断报告" }));
    expect(shell.exportDiagnostics).toHaveBeenCalled();
  });
});
