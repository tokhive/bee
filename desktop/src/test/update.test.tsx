import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { fakeShell, snapshot } from "./fakeShell";

async function openSettings() {
  const shell = fakeShell(snapshot());
  render(<App shell={shell} />);
  await userEvent.click(await screen.findByRole("button", { name: "设置" }));
  return shell;
}

describe("checking for updates under About", () => {
  it("checks on request and says when Bee is up to date", async () => {
    const shell = await openSettings();
    vi.mocked(shell.checkUpdate).mockImplementation(async () => {
      shell.pushUpdate({ state: "checking" });
      shell.pushUpdate({ state: "up_to_date" });
      return { state: "up_to_date" };
    });
    await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(shell.checkUpdate).toHaveBeenCalled();
    expect(await screen.findByText("已是最新版本。")).toBeInTheDocument();
  });

  it("offers a found update, installs it and shows the download", async () => {
    const shell = await openSettings();
    act(() => shell.pushUpdate({ state: "available", version: "1.1.0", notes: "Faster quota reads." }));
    expect(screen.getByText("有新版本 Bee 1.1.0。")).toBeInTheDocument();
    expect(screen.getByText("Faster quota reads.")).toBeInTheDocument();
    // The settings button is marked while an update waits.
    expect(screen.getByRole("button", { name: "设置" })).toHaveAttribute("title", "设置 · 有新版本");
    await userEvent.click(screen.getByRole("button", { name: "安装并重启" }));
    expect(shell.installUpdate).toHaveBeenCalled();
    act(() => shell.pushUpdate({ state: "downloading", version: "1.1.0", downloaded: 3, total: 4 }));
    expect(screen.getByText("正在下载 Bee 1.1.0… 75%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "下载进度" })).toHaveAttribute("aria-valuenow", "75");
    act(() => shell.pushUpdate({ state: "restarting", version: "1.1.0" }));
    expect(screen.getByText("Bee 1.1.0 已安装，正在重启…")).toBeInTheDocument();
  });

  it("a failed install can be tried again, checking first, or downloaded by hand", async () => {
    const shell = await openSettings();
    vi.mocked(shell.checkUpdate).mockResolvedValue({ state: "available", version: "1.1.1", notes: null });
    act(() => shell.pushUpdate({ state: "failed", stage: "install", message: "permission denied", version: "1.1.0" }));
    expect(screen.getByText(/安装更新失败/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "打开下载页面" }));
    expect(shell.openUrl).toHaveBeenCalledWith("https://github.com/tokhive/bee/releases/tag/desktop-v1.1.0");
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(shell.checkUpdate).toHaveBeenCalled();
    expect(shell.installUpdate).toHaveBeenCalled();
  });

  it("trying again installs nothing when the check finds no update", async () => {
    const shell = await openSettings();
    vi.mocked(shell.checkUpdate).mockResolvedValue({ state: "up_to_date" });
    act(() => shell.pushUpdate({ state: "failed", stage: "download", message: "bad signature", version: "1.1.0" }));
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(shell.checkUpdate).toHaveBeenCalled();
    expect(shell.installUpdate).not.toHaveBeenCalled();
  });

  it("a failed check says so and can check again", async () => {
    const shell = await openSettings();
    act(() => shell.pushUpdate({ state: "failed", stage: "check", message: "offline", version: null }));
    expect(screen.getByText("检查更新失败，请检查网络后重试。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(shell.checkUpdate).toHaveBeenCalled();
  });

  it("a development build cannot check", async () => {
    const shell = await openSettings();
    act(() => shell.pushUpdate({ state: "unconfigured" }));
    expect(screen.getByRole("button", { name: "检查更新" })).toBeDisabled();
    expect(screen.getByText("这个版本没有配置更新（开发版）。")).toBeInTheDocument();
  });
});
