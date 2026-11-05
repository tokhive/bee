import type {NavigationTarget} from '../../app/navigation';
import {supplyProblem} from '../accounts/accountPresentation.ts';
import type {DiagnosticCheck} from '../../system/diagnostics';

export interface CheckSections {
 issues:{device:DiagnosticCheck[];openai:DiagnosticCheck[];claude:DiagnosticCheck[]};
 unfinished:DiagnosticCheck[];
 passed:DiagnosticCheck[];
}

export function partitionChecks(checks:readonly DiagnosticCheck[]):CheckSections {
 const sections:CheckSections={issues:{device:[],openai:[],claude:[]},unfinished:[],passed:[]};
 for(const check of checks){
  if(check.status==='pass')sections.passed.push(check);
  else if(check.status==='skipped')sections.unfinished.push(check);
  else sections.issues[check.platform??'device'].push(check);
 }
 return sections;
}

const messages:Record<string,string>={pending:'等待检查',not_checked:'本次未完成此项检查',cancelled:'检查已取消',timeout:'检查超时',device_not_paired:'本机设备尚未连接，请前往概览配对',device_binding_valid:'本机绑定信息完整；远端身份需单独核对。',owned_runtime_connected:'贡献进程已连接',runtime_stopped:'贡献进程尚未运行',runtime_waiting:'接入账号后，Bee 将自动准备服务。',runtime_ownership_conflict:'检测到其他 Bee 进程',hive_identity_verified:'Hive 身份已核对',network_policy_observed:'已核对当前网络路径',network_changed:'网络配置已变化，请重新运行诊断',source_not_selected:'尚未选择此平台的账号',selected_source_read:'已读取所选官方登录',source_missing:'官方登录不存在',source_changed:'官方登录已变化，请前往账号重新检测',authorization_expired:'官方授权已失效',official_authorization_observed:'官方授权已核对',quota_available:'订阅额度可用',quota_exhausted:'订阅额度已耗尽',account_binding_verified:'账号绑定已核对',account_changed:'账号在检查期间发生变化',capabilities_synchronized:'能力已同步',taking_new_work:'可以接收新任务',supply_blocked:'当前未接收新任务',dns_failed:'域名解析失败',tls_failed:'安全连接校验失败',connection_failed:'无法连接服务',http_rejected:'服务拒绝了本次查询',rate_limited:'查询受到限流，请稍后重试'};

export function presentDiagnosticCheck(check:DiagnosticCheck):{message:string;target:NavigationTarget|null}{
 const specific:Record<string,string>={device_replaced:'此设备已被替换，原设备凭据已撤销。',invalid_device_credential:'Hive 已拒绝此设备凭据。',source_missing:'未找到所选凭证来源。'};
 const reason=check.status==='fail'&&check.id==='hive'&&check.platform===null&&check.code==='http_rejected'&&check.evidence.method==='GET'&&check.evidence.path==='/api/bee/identity'&&check.evidence.http_status==='401'&&check.evidence.server_code==='invalid_device_credential'?'invalid_device_credential':check.code;
 let target:NavigationTarget|null=null;
 if(check.status!=='pass'&&check.code!=='pending'){
  if(['device_replaced','invalid_device_credential','device_not_paired'].includes(reason))target={page:'overview',section:'device'};
  else if(check.next_action==='diagnostics')target=null;
  else if(check.id==='source'&&check.platform)target={page:'accounts',section:'source',platform:check.platform};
  else if(check.id==='supply'&&check.platform&&check.evidence.reason)target=supplyProblem(check.evidence.reason,check.platform).target;
  else if(check.next_action==='settings')target={page:'settings',section:'network'};
  else if(check.next_action==='accounts')target={page:'accounts',section:'account',...(check.platform?{platform:check.platform}:{})};
  else target={page:'overview',section:check.id==='runtime'?'runtime':check.id==='hive'?'connection':'device'};
 }
 return {message:specific[reason]??messages[reason]??'此项结果尚未确认，请查看检查详情。',target};
}
