import type {UiFailure} from '../system/failures';
import {safeFailureText,requestNotSent} from '../system/failures.ts';
import type {NavigationTarget} from '../app/navigation';
import {translate,formatDate} from '../i18n/index.ts';
export interface PresentedProblem {summary:string;impact:string;details:string;action:NavigationTarget|null;actionLabel?:string;detailsLabel?:string}
const copy:Record<string,string>={
 NETWORK_STOP_UNCONFIRMED:'贡献停止尚未确认，未继续应用网络配置。',NETWORK_APPLY_UNCONFIRMED:'网络配置回读尚未确认，未继续恢复贡献。',NETWORK_RESTORE_UNCONFIRMED:'恢复贡献后的网络身份不一致。',NETWORK_RUNTIME_UNCONFIRMED:'当前运行与网络状态未能一致核对。',NETWORK_SAVED_CHANGED:'停止期间已保存的网络配置发生变化。',NETWORK_INSTANCE_CHANGED:'网络应用期间管理进程实例发生变化。',AUTOSTART_UNCONFIRMED:'系统启动登记与期望不一致。',AUTOSTART_REGISTER_FAILED:'系统启动登记失败。',AUTOSTART_QUERY_FAILED:'系统启动登记读取失败。',NOTIFICATION_NATIVE:'系统通知投递失败。',NOTIFICATION_PERMISSION:'系统通知权限检查失败。',

 client_missing:'未找到已安装的官方客户端。',client_version_unsupported:'官方客户端版本不在支持范围内。',client_version_probe_failed:'无法读取官方客户端版本。',client_capability_missing:'官方客户端缺少所需登录命令。',client_capability_probe_failed:'无法核验官方客户端登录命令。',authorization_namespace_mismatch:'所选登录位置与官方客户端登录位置不一致。',authorization_source_unchanged:'官方登录已退出，但所选来源没有改变。',authorization_process_failed:'官方登录进程执行失败。',authorization_candidate_unconfirmed:'官方登录后的候选账号尚未核验。',authorization_timeout:'官方登录已超时。',authorization_cancelled:'官方登录进程已取消。',authorization_unconfirmed:'官方登录结果尚未确认。',
 offline:'Hive 未看到此平台的 Bee 连接',authorization_rejected:'上游平台已拒绝此账号授权。',confirmation_required:'账号变更待确认。',hive_unconfirmed:'Hive 账号状态尚未确认。',notice_storage_unconfirmed:'账号问题通知的本机去重记录保存未确认。',
 ACCOUNT_CONTEXT_CHANGED:'账号提交条件已经变化，本次未提交。',DEVICE_CONTEXT_INVALID:'已保存的本机设备配置未通过校验。',DEVICE_CONTEXT_UNCONFIGURED:'尚未配置本机设备。',NETWORK_APPLY_REQUIRED:'已保存的网络设置尚未应用。',
 dns_failed:'无法解析 Hive 地址。',tls_failed:'Hive 安全连接验证失败。',connection_refused:'Hive 拒绝网络连接。',timeout:'请求已超时。',http_rejected:'Hive 拒绝了本次请求（HTTP {status}）。',unavailable:'Hive 暂时无法处理本次请求（HTTP {status}）。',device_replaced:'此设备已被替换，原设备凭据已撤销。',invalid_device_credential:'Hive 已拒绝此设备凭据。',source_missing:'未找到所选凭证来源。',permission_denied:'没有读取所选凭证来源的权限。',source_unavailable:'所选凭证来源暂不可读取。',source_changed:'所选凭证来源已经变化。',invalid_credentials:'所选来源的凭证格式无效。',expired:'所选来源的授权已过期。',missing_scope:'所选账号缺少所需授权范围。',unsupported_store:'当前系统不支持所选凭证存储方式。',connection_closed:'Hive 连接已关闭。',synchronization_failed:'Hive 同步失败。',ownership_unconfirmed:'设备连接归属尚未确认。',pairing_expired:'设备配对码已过期。',rate_limited:'服务限制了本次请求的频率。',DESKTOP_STALE_RESULT:'本次读取早于已确认的状态。',FAILURE_DETAILS_INVALID:'本次失败详情未通过安全校验。',NATIVE_UNAVAILABLE:'原生管理环境不可用。',NETWORK_DEVICE_SCOPE:'设备身份不足以确认网络设置的作用域。',PREFERENCES_READ_FAILED:'无法读取应用设置。',PREFERENCES_SAVE_FAILED:'无法保存应用设置。',
};
export function presentFailure(failure:UiFailure,locale:'zh'|'en'):PresentedProblem {
 const tr=(s:string,p?:Record<string,string|number>)=>translate(s,locale,p);
 const status=failure.evidence.http_status??tr('未知');
 const reason=failure.code==='source_unavailable'&&failure.evidence.permission_denied==='true'?'permission_denied':failure.code==='source_unavailable'&&failure.evidence.not_found==='true'?'source_missing':failure.code;
 const unsent=requestNotSent(failure);
 const stageCopy:Record<string,string>={network_observe:'应用前的运行与网络读取失败。',network_stop:'停止贡献的结果尚未确认，网络应用已暂停。',network_configure:'应用网络配置时发生错误，生效状态需重新核对。',network_configure_readback:'网络配置回读失败，贡献恢复尚未执行。',network_restore:'恢复贡献时发生错误，当前运行状态需重新核对。'};
 const summary=tr(unsent?'本次请求未发送，操作未提交。':copy[reason]??stageCopy[failure.check]??'本次操作失败，原因尚未确认。',{status});
 const device=failure.check.startsWith('device_')||failure.check.startsWith('pairing_');
 const account=['source_missing','permission_denied','source_unavailable','source_changed','invalid_credentials','expired','missing_scope','unsupported_store','authorization_namespace_mismatch','authorization_source_unchanged','authorization_candidate_unconfirmed'].includes(failure.code);
 const official=failure.check.startsWith('official_')||failure.code.startsWith('client_')||failure.code.startsWith('authorization_');
 const revoked=['device_replaced','invalid_device_credential'].includes(failure.code);
 const invalidContext=failure.code==='DEVICE_CONTEXT_INVALID',unconfigured=failure.code==='DEVICE_CONTEXT_UNCONFIGURED',networkApply=failure.code==='NETWORK_APPLY_REQUIRED';
 const officialImpact=failure.code==='client_missing'?'请先安装该平台官方 CLI：OpenAI 使用 Codex，Claude 使用 Claude Code。':failure.code==='client_version_unsupported'?'支持 Codex 0.162.x／0.163.x，以及 Claude Code 2.1.153 以上的 2.1.x；请核对已安装版本。':failure.code==='client_capability_missing'?'当前客户端没有提供所需命令能力；请安装受支持的官方版本后再明确发起登录。':'本次未确认新的可接入账号；官方客户端登录可能已改变，请先核对所选来源。不会自动接入或恢复接单。';
 const impact=tr(unsent?'不会自动重试本次操作。核对当前状态后，请再次确认提交。':failure.code==='ACCOUNT_CONTEXT_CHANGED'?'请核对当前设备、运行与账号状态；确认后可重新提交。':invalidContext?'依赖设备身份的操作保持不可用；请导出诊断报告并联系支持修复本机设备配置，修复后重新检查设备。':unconfigured?'请在概览连接本机设备；配对不会自动开始贡献。':networkApply?'请在设置的网络页签应用已保存的网络设置，然后重新检查设备。重新检查不会自动应用网络设置。':revoked?'设备身份已失效，无法开始贡献；请先在 Hive 核对设备归属。':official?officialImpact:account?'本次只确认了所选来源的读取结果，其他登录状态仍未知。':device?'本次设备状态不可确认，依赖设备身份的操作保持不可用。':failure.check.startsWith('supply_')?'本次平台接单状态不可确认；修改结果未知时只核对，不自动重放。':'本次操作未能完成；后续状态以重新核对的结果为准。');
 let action:NavigationTarget|null=null;
 if(revoked||failure.code==='pairing_expired')action={page:'overview',section:'device'};
 if(account)action={page:'accounts',section:'source'};
 if(failure.code==='confirmation_required'||failure.code==='authorization_rejected')action={page:'accounts',section:'account'};
 if(failure.code==='offline')action={page:'overview',section:'connection'};
 if(invalidContext)action={page:'diagnostics'};
 if(unconfigured)action={page:'overview',section:'device'};
 if(networkApply)action={page:'settings',section:'network'};
 const labels:Record<string,string>={code:'错误码',check:'失败环节',observed_at:'观察时间',original:'原始原因',target_origin:'目标',path:'路径',http_status:'HTTP 状态',remote_code:'远端错误码',response_body:'安全响应',source_type:'来源类型',actual:'实际值',required:'要求'};
 const rows=[[tr(labels.code),failure.code],[tr(labels.check),failure.check],...(failure.observedAt?[[tr(labels.observed_at),formatDate(failure.observedAt,locale)]]:[]),...Object.entries(failure.evidence).map(([key,value])=>[tr(labels[key]??key),value]),[tr(labels.original),failure.message]];
 return {summary,impact,details:rows.map(([key,value])=>`${key}: ${safeFailureText(value)}`).join('\n'),action,actionLabel:tr(action?.page==='diagnostics'?'查看诊断':action?.page==='settings'?'查看设置':action?.section==='source'?'检查凭证来源':action?.section==='account'?'查看账号详情':action?.section==='connection'?'查看连接':'查看设备'),detailsLabel:tr('查看失败详情')};
}
