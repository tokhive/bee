import {safeFailureText,type UiFailure} from '../../system/failures.ts';

/** Classify only observed transport facts; a status code never proves a protocol upgrade. */
export function deviceProblem(failure:UiFailure){
 const status=failure.evidence.http_status??failure.message.match(/\bHTTP(?:\/[\d.]+)?\s+(\d{3})\b/i)?.[1];
 const kind=failure.evidence.failure_kind??failure.code;
 if(['device_replaced','invalid_device_credential'].includes(failure.code))return {title:'设备绑定需要修复',reason:'Hive 已拒绝当前设备凭据，暂不可贡献。',action:'repair'} as const;
 if(failure.code==='DEVICE_CONTEXT_INVALID')return {title:'无法读取设备绑定',reason:safeFailureText(failure.message),action:'repair'} as const;
 if(failure.code==='ownership_unconfirmed')return {title:'Hive 连接归属未确认',reason:'Hive 尚未确认当前连接归属，暂不可贡献。',action:'retry'} as const;
 if(status==='503')return {title:'Hive 暂不可用',reason:'Hive 返回 HTTP 503，暂不可贡献。',action:'retry'} as const;
 if(kind==='connection_refused'||/connection refused|ECONNREFUSED/i.test(failure.message))return {title:'无法连接 Hive',reason:'Hive 拒绝网络连接，暂不可贡献。',action:'retry'} as const;
 if(kind==='timeout'||/context deadline exceeded|ETIMEDOUT|timed out/i.test(failure.message))return {title:'连接 Hive 超时',reason:'等待 Hive 响应超时，暂不可贡献。',action:'retry'} as const;
 const message=safeFailureText(failure.message);
 return {title:'暂时无法确认 Hive 状态',reason:message.length>240?message.slice(0,240)+'…':message,action:'recheck'} as const;
}
