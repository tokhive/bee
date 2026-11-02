const groups = [
 ['设备绑定', [['device-loading','初次读取'],['device-draining','等待旧设备收尾'],['device-awaiting-confirmation','首次未提交确认'],['device-creating','正在创建请求'],['device-creation-unknown','创建结果未知'],['device-redeeming','兑换后身份核对'],['device-redemption-unknown','兑换结果未知'],['device-saving','本机保存失败'],['device-unbound','尚未绑定'],['device-pending','等待网页确认'],['device-expired','配对已过期'],['device-bound','设备已绑定'],['device-error','设备核对失败']]],
 ['设备恢复', [['device-recovery-confirm','凭据撤销确认'],['recovery-pending','恢复等待网页'],['recovery-draining','恢复等待旧设备'],['recovery-creation-unknown','恢复创建未知'],['recovery-redemption-unknown','恢复兑换未知'],['recovery-owner','新归属确认'],['recovery-saving','恢复保存失败'],['recovery-completed','恢复完成仍停止']]],
 ['设置与诊断', [['settings-general','语言与外观'],['settings-network','保存与生效网络'],['settings-system','通知与自启'],['settings-about','已保存设备与版本'],['diagnostics-running','正在诊断'],['diagnostics-results','完整诊断结果'],['diagnostics-read-failed','原报告读取失败'],['diagnostics-export-unknown','导出结果未知'],['update-downloading','更新下载中'],['update-verified','已验证待安装'],['update-unknown','安装结果未知'],['update-failed','签名下载失败']]],
 ['跨页组合', [['device-revoked-source-missing','已保存绑定凭据撤销与所选文件缺失'],['bridge-starting','管理进程启动中'],['bridge-failed','管理进程失败'],['startup-blocked','启动身份受阻']]],
 ['贡献运行', [['runtime-connecting','首次连接'],['runtime-rejected','身份拒绝'],['runtime-occupied','连接占用'],['stopped','尚未开始'],['runtime-starting','正在启动'],['running','贡献运行中'],['runtime-stopping','正在停止'],['runtime-disconnected','连接断开'],['runtime-unknown','启动结果未确认','start-unknown']]],
 ['AI 账号', [['account-reading','正在读取登录'],['account-empty','没有已有登录'],['account-candidate','候选尚未接入'],['account-selected','账号已接入'],['account-error','登录读取失败'],['account-expired','登录已过期'],['account-change','候选账号已变化']]],
 ['接单条件', [['supply-ready','满足接单条件'],['supply-paused','手动暂停'],['supply-blocked','多个阻塞原因'],['supply-partial','单平台未就绪']]],
 ['自动核对', [['check-background','后台正常核对'],['check-expired','报告已过期'],['check-waiting','等待自动重试'],['check-retrying','重试中'],['check-recovered','核对已恢复'],['check-sequence','完整自动恢复过程']]],
 ['额度报告', [['quota-normal','正常额度'],['quota-unknown','额度未知'],['quota-expired','额度报告过期'],['quota-multiple','多个额度窗口'],['quota-over','使用量超过 100%']]],
 ['确认与详情', [['confirm-login','官方登录确认','login'],['confirm-select','接入确认','select'],['confirm-stop','停止贡献确认','stop'],['confirm-change','换号确认','change'],['confirm-clear','取消接入确认','clear'],['account-detail','账号详情与来源设置','detail']]],
];
const notes = {
 'check-sequence':'观察有效报告 → 过期核对 → 读取失败 → 等待自动重试 → 10 秒后重试 → 恢复。只重新读取，不重放写入；重置从头播放。',
 'check-retrying':'首次读取失败，等待正式 10 秒重试后保持读取中；没有旧可接单状态。',
 'check-expired':'报告在约 100 毫秒后自然超过 30 秒有效期，随后保持只读核对中；旧报告不应显示可接单或允许修改。',
 'runtime-unknown':'通过正式开始按钮模拟一次结果丢失；随后只读核对持续失败，不重复开始。',
 'account-error':'仅 OpenAI 来源读取权限失败；Claude 保持正常。',
};
export const scenes = groups.flatMap(([group,items])=>items.map(([id,label,action])=>({id,group,label,description:notes[id]??`${label}：使用正式页面与模拟数据。操作仅影响当前预览；重置可恢复场景。`,page:id.startsWith('settings-')||id.startsWith('update-')?'settings':id.startsWith('diagnostics-')?'diagnostics':group==='AI 账号'||group==='额度报告'||group==='确认与详情'&&id!=='confirm-stop'?'accounts':'overview',...(action?{action}:{})})));
export const getScene = id => scenes.find(scene=>scene.id===id)??scenes.find(scene=>scene.id==='running');
