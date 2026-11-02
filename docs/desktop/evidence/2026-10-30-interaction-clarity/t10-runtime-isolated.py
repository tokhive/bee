"""仅使用 T10 专属 internal 网络、临时 DB 与无 GUI QA 容器。"""
import json,subprocess
network="bee-t10-runtime-internal-20261103"
data=json.loads(subprocess.check_output(["docker","network","inspect",network],text=True))[0]
print(json.dumps(data,indent=2),flush=True)
assert data["Internal"] is True
subprocess.run(["docker","run","--rm","--name","bee-t10-runtime-route-20261103","--network",network,"bee-linux-minimum-window-qa:20261023","sh","-c","cat /proc/net/route; ! awk \'$2 == \"00000000\" { found=1 } END { exit !found }\' /proc/net/route"],check=True)
subprocess.run(["docker","run","--rm","--name","bee-t10-runtime-qa-20261103","--network",network,"-v","/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/.cache/interaction-clarity-linux:/qa:ro","-v","/Users/dayong/myspace/mywork/tokenhive/.worktrees/hive-desktop-interaction:/hive:ro","-w","/hive/hive/internal/integration","-e","TEST_BEE_BIN=/qa/bee-final","-e","TEST_DATABASE_URL=postgres://hive:hive_local_dev@t10-postgres:5432/hive?sslmode=disable","-e","TEST_ISOLATED_INTERNAL_NETWORK=1","bee-linux-minimum-window-qa:20261023","/qa/hive-integration-race-v9.test","-test.run","^TestDesktopBrokerRuntime","-test.v","-test.timeout=240s"],check=True)
