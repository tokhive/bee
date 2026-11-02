import type {UiFailure} from '../system/failures';
import {safeFailureText,requestNotSent} from '../system/failures.ts';
import type {NavigationTarget} from '../app/navigation';
import {translate,formatDate} from '../i18n/index.ts';
export interface PresentedProblem {summary:string;impact:string;details:string;action:NavigationTarget|null;actionLabel?:string;detailsLabel?:string}
const copy:Record<string,string>={
 ACCOUNT_CONTEXT_CHANGED:'账号提交条件已经变化，本次未提交。',DEVICE_CONTEXT_INVALID:'已保存的本机设备配置未通过校验。',DEVICE_CONTEXT_UNCONFIGURED:'尚未配置本机设备。',NETWORK_APPLY_REQUIRED:'已保存的网络设置尚未应用。',
 dns_failed:'无法解析 Hive 地址。',tls_failed:'Hive 安全连接验证失败。',connection_refused:'Hive 拒绝网络连接。',timeout:'请求已超时。',http_rejected:'Hive 拒绝了本次请求（HTTP {status}）。',unavailable:'Hive 暂时无法处理本次请求（HTTP {status}）。',device_replaced:'此设备已被替换，原设备凭据已撤销。',invalid_device_credential:'Hive 已拒绝此设备凭据。',source_missing:'未找到所选凭证来源。',permission_denied:'没有读取所选凭证来源的权限。',source_unavailable:'所选凭证来源暂不可读取。',source_changed:'所选凭证来源已经变化。',invalid_credentials:'所选来源的凭证格式无效。',expired:'所选来源的授权已过期。',missing_scope:'所选账号缺少所需授权范围。',unsupported_store:'当前系统不支持所选凭证存储方式。',connection_closed:'Hive 连接已关闭。',synchronization_failed:'Hive 同步失败。',ownership_unconfirmed:'设备连接归属尚未确认。',pairing_expired:'设备配对码已过期。',rate_limited:'服务限制了本次请求的频率。',DESKTOP_STALE_RESULT:'本次读取早于已确认的状态。',FAILURE_DETAILS_INVALID:'本次失败详情未通过安全校验。',NATIVE_UNAVAILABLE:'原生管理环境不可用。',NETWORK_DEVICE_SCOPE:'设备身份不足以确认网络设置的作用域。',PREFERENCES_READ_FAILED:'无法读取应用设置。',PREFERENCES_SAVE_FAILED:'无法保存应用设置。',
};
export function presentFailure(failure:UiFailure,locale:'zh'|'en'):PresentedProblem {
 const tr=(s:string,p?:Record<string,string|number>)=>translate(s,locale,p);
 const status=failure.evidence.http_status??tr('未知');
 const reason=failure.code==='source_unavailable'&&failure.evidence.permission_denied==='true'?'permission_denied':failure.code==='source_unavailable'&&failure.evidence.not_found==='true'?'source_missing':failure.code;
 const unsent=requestNotSent(failure);
 const summary=tr(unsent?'本次请求未发送，操作未提交。':copy[reason]??'本次操作失败，原因尚未确认。',{status});
 const device=failure.check.startsWith('device_')||failure.check.startsWith('pairing_');
 const account=['source_missing','permission_denied','source_unavailable','source_changed','invalid_credentials','expired','missing_scope','unsupported_store'].includes(failure.code);
 const revoked=['device_replaced','invalid_device_credential'].includes(failure.code);
 const invalidContext=failure.code==='DEVICE_CONTEXT_INVALID',unconfigured=failure.code==='DEVICE_CONTEXT_UNCONFIGURED',networkApply=failure.code==='NETWORK_APPLY_REQUIRED';
 const impact=tr(unsent?'不会自动重试本次操作。核对当前状态后，请再次确认提交。':failure.code==='ACCOUNT_CONTEXT_CHANGED'?'请核对当前设备、运行与账号状态；确认后可重新提交。':invalidContext?'依赖设备身份的操作保持不可用；请导出诊断报告并联系支持修复本机设备配置，修复后重新检查设备。':unconfigured?'请在概览连接本机设备；配对不会自动开始贡献。':networkApply?'请在设置的网络页签应用已保存的网络设置，然后重新检查设备。重新检查不会自动应用网络设置。':revoked?'设备身份已失效，无法开始贡献；请先在 Hive 核对设备归属。':account?'本次只确认了所选来源的读取结果，其他登录状态仍未知。':device?'本次设备状态不可确认，依赖设备身份的操作保持不可用。':failure.check.startsWith('supply_')?'本次平台接单状态不可确认；修改结果未知时只核对，不自动重放。':'本次操作未能完成；后续状态以重新核对的结果为准。');
 let action:NavigationTarget|null=null;
 if(revoked||failure.code==='pairing_expired')action={page:'overview',section:'device'};
 if(account)action={page:'accounts',section:'source'};
 if(invalidContext)action={page:'diagnostics'};
 if(unconfigured)action={page:'overview',section:'device'};
 if(networkApply)action={page:'settings',section:'network'};
 const labels:Record<string,string>={code:'错误码',check:'失败环节',observed_at:'观察时间',original:'原始原因',target_origin:'目标',path:'路径',http_status:'HTTP 状态',remote_code:'远端错误码',response_body:'安全响应',source_type:'来源类型',actual:'实际值',required:'要求'};
 const rows=[[tr(labels.code),failure.code],[tr(labels.check),failure.check],...(failure.observedAt?[[tr(labels.observed_at),formatDate(failure.observedAt,locale)]]:[]),...Object.entries(failure.evidence).map(([key,value])=>[tr(labels[key]??key),value]),[tr(labels.original),failure.message]];
 return {summary,impact,details:rows.map(([key,value])=>`${key}: ${safeFailureText(value)}`).join('\n'),action,actionLabel:tr(invalidContext?'查看诊断':networkApply?'查看设置':account?'检查凭证来源':'查看设备'),detailsLabel:tr('查看失败详情')};
}
