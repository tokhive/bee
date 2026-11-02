# T10 fix2 受影响界面自检

范围仅为 `desktop/src/presentation/problems.ts`／`desktop/src/i18n/en.ts` 新增的两码提示及既有 `ProblemNotice` 消费路径，不是整站、完整分支或全76场景审查。使用最新抓取的 `t10-fix2-web-interface-guidelines.md`（来源 https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md）。遵循批准布局，不新增结构、控件、动画或导航动作。

- `desktop/src/presentation/problems.ts:7`、`:91`：两码明确表达协议不兼容／完整性校验失败；影响说明原生操作受阻，下一步与应用菜单退出/重开或可信安装包匹配。未知码不靠英文消息分类。错误证据保留同一提示详情。
- `desktop/src/i18n/en.ts:164`：四条新增中英文文案有完整映射，Node与组件测试精确断言；真实协议/SHA原文保留英文技术详情。
- `desktop/src/components/ProblemNotice.tsx:8`：沿用现有role=alert、原生details/summary及换行能力。Ego v3实测860×600，中英各两码、中文light/英文dark、reduced-motion=true；摘要与影响位于固定栏之间，键盘Enter展开保持summary焦点且有可见金色焦点框，原始安全详情可读，无新增无效按钮或业务写。
- 实看两张代表图：`t10-fix2-ego-v3-protocol-zh-light-details.png` 与 `t10-fix2-ego-v3-integrity-en-dark-details.png`。其余图具有自动几何／内容断言，未宣称逐张人工实看。

本次范围无新增可行动问题。未量测完整对比度矩阵或使用真实辅助技术；未检查原生菜单实际退出、重开、签名安装恢复，也不升级为真实原生验收。大chunk既有警告单独保留。
