# Bee 原生自动服务预览历史

以选择的历史目录作为独立网站根目录运行：

```sh
python3 -m http.server 1492 --bind 127.0.0.1 --directory '<历史目录绝对路径>'
```

## 原生自动服务场景迁移（2026-11-05）

当前工作预览仍由 `../index.html` 打开；本轮默认原生入口已取消日常总开关，停止状态提供重试准备，未知结果只核对原过程。以下是本轮冻结的前端 mock 历史，非真实 Hive／官方登录或签名 App。

| 时间（Asia/Shanghai） | 变更与来源 | 评审状态 | 完整 HTML 快照 |
| --- | --- | --- | --- |
| 2026-11-05 17:51:30 | 修改前捕获，误用 demo 构建模式 | 未通过原生预览验证；原样保留 | [模式错误快照](20261105-175130-before-native-preview/tests/fixtures/bee-preview/index.html) |
| 2026-11-05 18:09:51 | 从 HEAD 重建旧场景，其余为构建时共享工作区；不是完整原始快照 | 重建，旧确认场景仍与新入口不匹配 | [重建快照](20261105-180951-before-native-preview-rebuilt/tests/fixtures/bee-preview/index.html) |
| 2026-11-05 18:13:34 | 对齐自动服务的交付快照，来源哈希见 SOURCE.md | 待评审；前端 mock 67 项及静态包关键动作已验证 | [迁移快照](20261105-181334-native-auto-service-preview/tests/fixtures/bee-preview/index.html) |

各目录包含冻结 HTML、JavaScript、CSS、图片与模拟数据。以选中目录作为独立网站根目录运行上方 Python 命令，访问 `/tests/fixtures/bee-preview/index.html?scene=running&theme=light`；支持 scene/theme/size，开发事件另加 debug=1。冻结版本不随之后的源码修复更新。
