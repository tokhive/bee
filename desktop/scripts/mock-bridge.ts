// Development only: lets the window run in an ordinary browser against a mock
// or real Bee. `BEE_DEV_CONFIG=/tmp/beedev/bee.json npm run dev` forwards
// /__bee/v1/... to the control socket next to that configuration, so the
// window's browser stand-in for the shell (src/lib/devShell.ts) can reach it.
import { request } from "node:http";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

export function mockBridge(): Plugin {
  return {
    name: "bee-mock-bridge",
    apply: "serve",
    configureServer(server) {
      const config = process.env.BEE_DEV_CONFIG;
      if (!config) return;
      const socketPath = join(dirname(config), "control", "bee.sock");
      server.middlewares.use("/__bee", (req, res) => {
        const upstream = request(
          { socketPath, path: req.url, method: req.method, headers: { host: "bee", "content-type": "application/json" } },
          (answer) => {
            res.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(res);
          },
        );
        upstream.on("error", (err) => {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "unreachable", message: err.message } }));
        });
        req.pipe(upstream);
      });
    },
  };
}
