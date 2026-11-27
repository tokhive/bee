import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { Network, NetworkCheck } from "../lib/bee";
import { fakeShell, noProxy, overview, platform, refuse, snapshot } from "./fakeShell";

async function openNetwork(network: Partial<Network> = {}, change: Parameters<typeof snapshot>[0] = {}) {
  const shell = fakeShell(snapshot(change));
  let current: Network = { ...noProxy, ...network };
  let check: NetworkCheck = { ok: true, target: "chatgpt.com:443" };
  shell.answer((method, path, body) => {
    if (path === "/v1/network" && method === "GET") return current;
    if (path === "/v1/network" && method === "PUT") {
      const value = (body as { connect_proxy: string }).connect_proxy;
      if (value && !/^http:\/\/127\.0\.0\.1:\d+$/.test(value)) refuse(400, "invalid_proxy");
      current = { ...current, connect_proxy: value, source: value ? "desktop" : "", restart_required: value !== current.active_proxy };
      return current;
    }
    if (path === "/v1/network/check") return check;
  });
  render(<App shell={shell} />);
  await userEvent.click(await screen.findByRole("button", { name: "设置" }));
  return { shell, setCheck: (next: NetworkCheck) => (check = next), current: () => current };
}

describe("network proxy setting", () => {
  it("saves a proxy and offers a restart that applies it", async () => {
    const { shell } = await openNetwork();
    const field = await screen.findByLabelText("代理地址");
    expect(screen.getByText(/连接 TokHive 本身不走这个代理/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await userEvent.type(field, " http://127.0.0.1:7890 ");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(shell.calls.at(-1)).toMatchObject({ method: "PUT", path: "/v1/network", body: { connect_proxy: "http://127.0.0.1:7890" } });
    expect(await screen.findByText("已保存，重启后台服务后生效。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "现在重启" }));
    expect(shell.restartService).toHaveBeenCalled();
    expect(screen.getByText("正在重启后台服务…")).toBeInTheDocument();
  });

  it("reads the setting again when a new Bee has started", async () => {
    const { shell, current } = await openNetwork({ connect_proxy: "http://127.0.0.1:7890", source: "desktop", restart_required: true });
    expect(await screen.findByText("已保存，重启后台服务后生效。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "现在重启" }));
    // The new Bee reports the proxy as in use.
    Object.assign(current(), { active_proxy: "http://127.0.0.1:7890", restart_required: false });
    const next = snapshot({ overview: overview({ pid: 2 }) });
    await act(async () => shell.push(next));
    await waitFor(() => expect(screen.queryByText("正在重启后台服务…")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "现在重启" })).not.toBeInTheDocument();
  });

  it("tells a Bee started elsewhere to be restarted by hand", async () => {
    await openNetwork({ connect_proxy: "http://127.0.0.1:7890", source: "desktop", restart_required: true }, { service: "external" });
    expect(await screen.findByText("已保存，需要重启 Bee 后生效。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "现在重启" })).not.toBeInTheDocument();
  });

  it("says why a bad address was refused", async () => {
    const { shell } = await openNetwork();
    await userEvent.type(await screen.findByLabelText("代理地址"), "http://proxy.example.com:7890");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText(/代理地址不对。只支持本机的 HTTP 代理/)).toBeInTheDocument();
    expect(shell.restartService).not.toHaveBeenCalled();
  });

  it("tests the address in the box without saving it, in words about what to do", async () => {
    const { shell, setCheck } = await openNetwork();
    await userEvent.type(await screen.findByLabelText("代理地址"), "http://127.0.0.1:7890");
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(await screen.findByText("可以通过这个代理连上 chatgpt.com:443。")).toBeInTheDocument();
    expect(shell.calls.some((call) => call.method === "PUT")).toBe(false);

    setCheck({ ok: false, target: "chatgpt.com:443", problem: { code: "proxy_unreachable", message: "x" } });
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(await screen.findByText(/这个地址上没有程序在监听/)).toBeInTheDocument();

    setCheck({ ok: false, target: "chatgpt.com:443", problem: { code: "proxy_refused", message: "x" } });
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(await screen.findByText(/代理收到了请求，但不肯连到官方服务/)).toBeInTheDocument();
  });

  it("tests without a proxy when the box is empty", async () => {
    const { shell } = await openNetwork();
    await screen.findByLabelText("代理地址");
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(await screen.findByText("不用代理也能连上 chatgpt.com:443。")).toBeInTheDocument();
    expect(shell.calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/network/check", body: { connect_proxy: "" } });
  });

  it("only shows a proxy that is set in Bee's own configuration", async () => {
    await openNetwork({ connect_proxy: "http://127.0.0.1:7890", active_proxy: "http://127.0.0.1:7890", source: "egress", editable: false });
    expect(await screen.findByText(/代理写在 Bee 的配置文件里（http:\/\/127.0.0.1:7890）/)).toBeInTheDocument();
    expect(screen.queryByLabelText("代理地址")).not.toBeInTheDocument();
  });

  it("only shows the proxy of a Bee run from the command line", async () => {
    await openNetwork({ editable: false, active_proxy: "http://127.0.0.1:7890" }, { service: "external", overview: overview({ mode: "cli" }) });
    expect(await screen.findByText(/这个 Bee 由命令行运行。请在命令行用 bee setup 修改代理。/)).toBeInTheDocument();
    expect(screen.getByText(/现在使用：http:\/\/127.0.0.1:7890/)).toBeInTheDocument();
    expect(screen.queryByLabelText("代理地址")).not.toBeInTheDocument();
  });

  it("warns that HTTPS_PROXY in Bee's process wins", async () => {
    await openNetwork({ env_override: true });
    expect(await screen.findByText(/Bee 进程设置了 HTTPS_PROXY/)).toBeInTheDocument();
  });

  it("says so when the setting cannot be read", async () => {
    const shell = fakeShell(snapshot());
    shell.answer((_m, path) => {
      if (path === "/v1/network") refuse(500, "error");
    });
    render(<App shell={shell} />);
    await userEvent.click(await screen.findByRole("button", { name: "设置" }));
    expect(await screen.findByText("读取不到网络设置")).toBeInTheDocument();
  });

  it("toasts when the restart is not possible", async () => {
    const { shell } = await openNetwork({ connect_proxy: "http://127.0.0.1:7890", source: "desktop", restart_required: true });
    vi.mocked(shell.restartService).mockResolvedValue(false);
    await userEvent.click(await screen.findByRole("button", { name: "现在重启" }));
    expect(await screen.findByText("重启失败")).toBeInTheDocument();
    expect(screen.queryByText("正在重启后台服务…")).not.toBeInTheDocument();
  });
});

describe("a card with no quota", () => {
  it("offers the proxy setting after a minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const shell = fakeShell(snapshot({ platforms: { claude: platform("sharing", undefined, { status: "unknown", windows: [] }), openai: platform("sharing") } }));
      render(<App shell={shell} />);
      await userEvent.click(await screen.findByRole("button", { name: "共享账号" }));
      await screen.findAllByText(/额度/);
      expect(screen.queryByText(/一直查不到额度/)).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(await screen.findByText(/一直查不到额度/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "设置代理" }));
      expect(await screen.findByLabelText("代理地址")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

