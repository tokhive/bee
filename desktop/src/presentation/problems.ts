import type {UiFailure} from '../system/failures';
import {safeFailureText,requestNotSent} from '../system/failures.ts';
import type {NavigationTarget} from '../app/navigation';
import {translate,formatDate} from '../i18n/index.ts';
export interface PresentedProblem {summary:string;impact:string;details:string;action:NavigationTarget|null;actionLabel?:string;detailsLabel?:string}
const copy:Record<string,string>={
 RECOVERY_SESSION_UNCONFIRMED:'上次运行未确认安全结束，暂未重新启动服务。',
 RECOVERY_RETIREMENT_CONFLICT:'Hive 拒绝结束旧会话，原记录已保留。请导出启动诊断以核对具体冲突。',
 RECOVERY_SERVER_UNSUPPORTED:'当前 Hive 尚不支持安全恢复，需要先升级 Hive。账号和设备信息已保留。',
 RECOVERY_REMOTE_DRAINING:'Hive 正在等待上次任务结束，暂未重新启动服务。稍后可继续恢复。',
 RECOVERY_RETIREMENT_UNCONFIRMED:'上次会话的结束结果尚未确认；继续恢复会核对原操作。',
 RECOVERY_RETIREMENT_INVALID:'本地会话结束记录未通过校验，已保留原记录。',
 RECOVERY_LOGIN_UNRESOLVED:'上次登录操作尚未核对，暂未结束旧会话。',
 RECOVERY_GUARD_UNCONFIRMED:'上次运行的保护记录尚未核实，暂未重新启动服务。',
 RECOVERY_OPERATION_UNRESOLVED:'上次账号操作的结果尚未确认。',
 RECOVERY_RESULT_UNCONFIRMED:'上次恢复的结果尚未确认，需要核对原操作。',
 RECOVERY_JOURNAL_INVALID:'本地恢复记录未通过校验，已保留原记录。',
 RECOVERY_JOURNAL_IO:'无法安全读取或保存本地恢复记录。',
 RECOVERY_JOURNAL_CONFLICT:'本地恢复记录与当前操作不一致。',
 RECOVERY_OWNER_BUSY:'后台仍有操作正在处理，请先核对当前状态。',
 RECOVERY_UNAVAILABLE:'后台启动来源未通过核验。',
 RECOVERY_CONTEXT_INVALID:'恢复所需的设备或后台状态尚未核实。',
 RECOVERY_FAILED:'上次恢复已失败，请查看具体失败环节。',

 VERSION_MISMATCH:'Bee 管理协议版本与当前应用不兼容。',
 BUNDLED_BEE_INVALID:'随附的 Bee 程序未通过完整性校验。',
 UPDATE_BYTES_MISSING:'已验证的更新内容不可读取，本次未退出或安装。',
 UPDATE_IDENTITY_MISSING:'更新包身份资料缺失。',
 UPDATE_NATIVE_HANDLE_MISSING:'已验证的原生更新句柄不可用。',
 UPDATE_MARKER_MISSING:'更新保护记录缺失，未继续安装。',
 UPDATE_RECOVERY_NOT_PENDING:'没有可核验的待完成更新。',
 UPDATE_BUSY:'另一项更新操作正在进行。',
 UPDATE_NOT_AVAILABLE:'当前没有可下载的更新。',
 UPDATE_STALE_OPERATION:'更新操作已经变化，本次回执未被采用。',
 UPDATE_OPERATION_MISSING:'更新操作缺少可核对的标识。',
 UPDATE_REVISION_EXHAUSTED:'更新状态修订号已达到安全上限。',
 UPDATE_STATE_POISONED:'更新状态锁失效，需要重新启动 Bee。',
 UPDATE_STATE_PATH_FAILED:'无法定位更新保护记录。',
 UPDATE_SIZE_INVALID:'更新包大小无效。',
 UPDATE_TARGET_INVALID:'更新目标平台无效。',
 UPDATE_CHANNEL_INVALID:'更新发布渠道无效。',
 UPDATE_ENDPOINT_INVALID:'可信更新地址无效。',
 UPDATE_VERSION_INVALID:'更新版本号无效。',
 UPDATE_TIME_INVALID:'更新检查时间无效。',
 NATIVE_LOCALE_LOCK:'原生语言状态锁失效，需要重新启动 Bee。',
 NATIVE_LOCALE_INPUT:'原生语言元数据未通过校验。',
 NATIVE_LOCALE_UNCONFIRMED:'原生有效语言尚未确认。',

 UPDATE_CHECK_FAILED:'更新检查失败。',
 UPDATE_CHECK_HTTP_FAILED:'更新服务拒绝了本次检查。',
 UPDATE_SIGNATURE_FAILED:'更新签名验证失败，未允许安装。',
 UPDATE_DOWNLOAD_FAILED:'更新下载失败。',
 UPDATE_DOWNLOAD_CANCELLED:'下载未通过进度校验，已停止。',
 UPDATE_DIGEST_MISMATCH:'更新包的大小或摘要与已核验清单不符。',
 UPDATE_SIZE_MISMATCH:'更新下载大小与清单不符。',
 UPDATE_INSTALL_FAILED:'安装程序报告失败，Bee 已停止。',
 UPDATE_NATIVE_INSTALL_FAILED:'原生安装程序执行失败。',
 UPDATE_EXIT_UNPROVEN:'退出回执不完整，未启动安装。',
 UPDATE_RECOVERY_PENDING:'更新后的启动核验尚未完成。',
 UPDATE_RECOVERY_UNPROVEN:'更新恢复证据不完整，保护仍保留。',
 UPDATE_RECOVERY_VERSION_MISMATCH:'重启版本与待核验更新不符。',
 UPDATE_RECOVERY_IDENTITY_MISMATCH:'重启版本或发布渠道未通过核验。',
 UPDATE_PREVIOUS_NOT_INSTALLED:'已核验原可信版本，目标更新尚未安装。',
 UPDATE_PREFERENCES_UNVERIFIED:'更新启动时偏好未通过核验。',
 UPDATE_STALE_REVISION:'安装确认已过期，本次未提交。',
 UPDATE_CONFIRMATION_REQUIRED:'安装需要当前更新的明确确认。',
 UPDATE_SPACE_INSUFFICIENT:'安装暂存空间不足。',
 UPDATE_SPACE_CHECK_FAILED:'无法核对安装暂存空间。',
 UPDATE_STATE_WRITE_UNCERTAIN:'更新保护记录的保存回执尚未确认。',
 UPDATE_STATE_WRITE_FAILED:'更新保护记录保存失败。',
 UPDATE_STATE_READ_FAILED:'更新保护记录读取失败。',
 UPDATE_STATE_INVALID:'更新保护记录未通过校验。',
 UPDATE_STATE_PROTECTION_FAILED:'更新保护记录的本机权限不符合要求。',
 UPDATE_STATE_VERSION_UNSUPPORTED:'更新保护记录版本不受支持。',
 UPDATE_NOT_CONFIGURED:'当前安装未配置可信更新来源。',
 UPDATE_CONFIGURATION_FAILED:'可信更新配置未通过校验。',
 UPDATE_MANIFEST_INVALID:'更新清单未通过校验。',
 UPDATE_TARGET_MISMATCH:'更新包与当前系统平台不符。',
 UPDATE_SIGNATURE_MISSING:'更新清单缺少签名。',
 UPDATE_ASSET_INVALID:'更新包来源或格式未通过校验。',
 UPDATE_TLS_UNAVAILABLE:'更新安全连接组件不可用。',
 NATIVE_LOCALE_REPLY_INVALID:'原生语言同步回执未通过校验。',
 NATIVE_LOCALE_STALE:'原生语言同步使用了过期偏好。',
 NATIVE_LOCALE_MISMATCH:'原生语言与已保存的语言不一致。',
 NATIVE_LOCALE_MENU_FAILED:'原生菜单语言更新失败。',
 NATIVE_LOCALE_PREFERENCES:'原生语言同步无法核验已保存偏好。',

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
 const stageCopy:Record<string,string>={update_install:'安装请求回执尚未确认。',update_download:'更新下载请求回执尚未确认。',update_check:'更新检查请求回执尚未确认。',update_snapshot:'更新状态读取失败。',network_observe:'应用前的运行与网络读取失败。',network_stop:'停止贡献的结果尚未确认，网络应用已暂停。',network_configure:'应用网络配置时发生错误，生效状态需重新核对。',network_configure_readback:'网络配置回读失败，贡献恢复尚未执行。',network_restore:'恢复贡献时发生错误，当前运行状态需重新核对。'};
 const summary=tr(unsent?'本次请求未发送，操作未提交。':failure.code==='RESPONSE_TIMEOUT'?'等待 Bee 响应超时，本次结果尚未确认。':copy[reason]??stageCopy[failure.check]??'本次操作失败：{reason}',{status,reason:safeFailureText(failure.message)});
 const device=failure.check.startsWith('device_')||failure.check.startsWith('pairing_');
 const account=['source_missing','permission_denied','source_unavailable','source_changed','invalid_credentials','expired','missing_scope','unsupported_store','authorization_namespace_mismatch','authorization_source_unchanged','authorization_candidate_unconfirmed'].includes(failure.code);
 const official=failure.check.startsWith('official_')||failure.code.startsWith('client_')||failure.code.startsWith('authorization_');
 const revoked=['device_replaced','invalid_device_credential'].includes(failure.code);
 const invalidContext=failure.code==='DEVICE_CONTEXT_INVALID',unconfigured=failure.code==='DEVICE_CONTEXT_UNCONFIGURED',networkApply=failure.code==='NETWORK_APPLY_REQUIRED';
 const officialImpact=failure.code==='client_missing'?'请先安装该平台官方 CLI：OpenAI 使用 Codex，Claude 使用 Claude Code。':failure.code==='client_version_unsupported'?'支持 Codex 0.162.x／0.163.x，以及 Claude Code 2.1.153 以上的 2.1.x；请核对已安装版本。':failure.code==='client_capability_missing'?'当前客户端没有提供所需命令能力；请安装受支持的官方版本后再明确发起登录。':'本次未确认新的可接入账号；官方客户端登录可能已改变，请先核对所选来源。不会自动接入或恢复接单。';
 const updateImpact=unsent?null:failure.code==='UPDATE_PREVIOUS_NOT_INSTALLED'?'目标更新尚未安装；当前可信版本及数据、运行恢复检查已通过。可重新检查并下载更新。':failure.check==='native_locale_sync'?'菜单和新系统通知的语言尚未同步；请重新读取偏好并同步。已有通知不会重发。':failure.check==='update_recovery'?'更新保护仍保留；请重新启动 Bee 核验原更新。若仍受阻，请保留记录并使用可信安装包处理，普通更新检查不能解除保护。':failure.code==='UPDATE_INSTALL_FAILED'?'现有数据与更新保护记录已保留。请使用可信安装包处理；重新读取状态不会重新安装。':failure.check==='update_signature'||failure.check==='update_digest'?'当前更新包不可安装。可重新检查并下载；若仍无法核验，请使用可信来源的安装包。':failure.check.startsWith('update_')?'安装完成只在重新启动并核验后确认。请求回执未知时只读取原更新，不重复提交。':null;
 const nativeImpact=failure.code==='RESPONSE_TIMEOUT'?'请先核对当前状态；未确认的操作不会自动重复提交。':failure.code==='VERSION_MISMATCH'?'原生操作保持受阻，无法开始贡献或执行账号操作。请从应用菜单退出 Bee 后重新打开；若仍不兼容，请使用可信来源的匹配安装包处理。':failure.code==='BUNDLED_BEE_INVALID'?'原生操作保持受阻，无法开始贡献或执行账号操作。请从应用菜单退出 Bee，使用可信来源的安装包重新安装后再打开。':null;
 const impact=tr(nativeImpact??updateImpact??(unsent?'不会自动重试本次操作。核对当前状态后，请再次确认提交。':failure.code==='ACCOUNT_CONTEXT_CHANGED'?'请核对当前设备、运行与账号状态；确认后可重新提交。':invalidContext?'依赖设备身份的操作保持不可用；请导出诊断报告并联系支持修复本机设备配置，修复后重新检查设备。':unconfigured?'请在概览连接本机设备；配对不会自动开始贡献。':networkApply?'请在设置的网络页签应用已保存的网络设置，然后重新检查设备。重新检查不会自动应用网络设置。':revoked?'设备身份已失效，无法开始贡献；请先在 Hive 核对设备归属。':official?officialImpact:account?'本次只确认了所选来源的读取结果，其他登录状态仍未知。':device?'本次设备状态不可确认，依赖设备身份的操作保持不可用。':failure.check.startsWith('supply_')?'本次平台接单状态不可确认；修改结果未知时只核对，不自动重放。':'本次操作未能完成；后续状态以重新核对的结果为准。'));
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
