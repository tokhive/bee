# 账户交互验收预览历史

当前工作预览：`../index.html?scene=accounts-auto-empty&theme=light&size=narrow`，开发调试另加 `&debug=1`。

| 时间 | 变更 | 评审状态 | 完整 HTML 快照 |
| --- | --- | --- | --- |
| 2026-11-05 15:30:25 Asia/Shanghai | 简化前：七个场景及折叠事件面板 | 已否定（验收复杂） | [20261105-153025-accounts-before-simple](20261105-153025-accounts-before-simple/tests/fixtures/bee-preview/index.html) |
| 2026-11-05 15:33:14 Asia/Shanghai | 简化后：三个验收项目及当前操作指引 | 待评审 | [20261105-153314-accounts-simple](20261105-153314-accounts-simple/tests/fixtures/bee-preview/index.html) |

来源：`feat/bee-desktop-ui-review` 工作区，每轮修改前及交付时使用 Vite 冻结。包含独立脚本、样式、图片和模拟数据；不依赖当前版源码或在线业务服务。为运行 mock，冻结构建保留开发预览开关，仅供评审。

历史包需要独立作为网站根目录启动，不能在当前 Vite 服务内直接打开子目录链接：

```sh
python3 -m http.server 1492 --bind 127.0.0.1 --directory '<选中的历史目录绝对路径>'
```

然后访问 `http://127.0.0.1:1492/tests/fixtures/bee-preview/index.html?scene=accounts-auto-empty&theme=light&size=narrow`。支持原有 `scene`、`theme`、`size` 参数；简化后支持 `debug=1`。直接用 file:// 打开不支持模块和 iframe 通信。

验证：两版均已在独立静态 HTTP 服务中打开，资源和账号页面正常；简化版已切换到“暂停与恢复”，点击 OpenAI 暂停后正确显示“已暂停接单”。当前开发版本的 15 项账户浏览器用例全部通过。

## 原生自动服务场景迁移（2026-11-05）

当前工作预览仍由 `../index.html` 打开；本轮默认原生入口已取消日常总开关，停止状态提供重试准备，未知结果只核对原过程。以下是本轮冻结的前端 mock 历史，非真实 Hive／官方登录或签名 App。

| 时间（Asia/Shanghai） | 变更与来源 | 评审状态 | 完整 HTML 快照 |
| --- | --- | --- | --- |
| 2026-11-05 17:51:30 | 修改前捕获，误用 demo 构建模式 | 未通过原生预览验证；原样保留 | [模式错误快照](20261105-175130-before-native-preview/tests/fixtures/bee-preview/index.html) |
| 2026-11-05 18:09:51 | 从 HEAD 重建旧场景，其余为构建时共享工作区；不是完整原始快照 | 重建，旧确认场景仍与新入口不匹配 | [重建快照](20261105-180951-before-native-preview-rebuilt/tests/fixtures/bee-preview/index.html) |
| 2026-11-05 18:13:34 | 对齐自动服务的交付快照，来源哈希见 SOURCE.md | 待评审；前端 mock 67 项及静态包关键动作已验证 | [迁移快照](20261105-181334-native-auto-service-preview/tests/fixtures/bee-preview/index.html) |

各目录包含冻结 HTML、JavaScript、CSS、图片与模拟数据。以选中目录作为独立网站根目录运行上方 Python 命令，访问 `/tests/fixtures/bee-preview/index.html?scene=running&theme=light`；支持 scene/theme/size，开发事件另加 debug=1。冻结版本不随之后的源码修复更新。

| 2026-11-12 21:52:52 Asia/Shanghai | Hive 切换前，3c713be 完整正式 mock | 修改前基线 | [完整快照](20261112-215252-before-hive-switch/tests/fixtures/bee-preview/index.html) |

| 2026-11-12 22:14:34 Asia/Shanghai | Hive 切换界面初版，最终原生字段核对前 | 中间快照；勿用于最终接口验收 | [完整快照](20261112-221434-hive-switch-interface/tests/fixtures/bee-preview/index.html) |
| 2026-11-12 22:26:01 Asia/Shanghai | Hive 切换最终 DTO、作用域事件、配对与恢复；正式 React mock 完整构建 | 待评审；342 单元与 28 相关浏览器用例通过 | [最终快照](20261112-222601-hive-switch-final/tests/fixtures/bee-preview/index.html) |
