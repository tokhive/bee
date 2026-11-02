import { Activity, House, Settings2, Users } from 'lucide-react';
import type { Page } from '../client/types';
export const navigation = [
  { id: 'overview', label: '概览', icon: House, description: '查看设备状态与贡献摘要。' },
  { id: 'accounts', label: 'AI 账号', icon: Users, description: '管理这台设备用于贡献的 AI 账号。' },
  { id: 'diagnostics', label: '诊断', icon: Activity, description: '检查 Bee 运行与连接状态。' },
  { id: 'settings', label: '设置', icon: Settings2, description: '管理设备偏好与应用设置。' },
] as const satisfies readonly { id: Page; label: string; icon: typeof Activity; description: string }[];

export type NavigationTarget = {page:'overview'|'accounts'|'diagnostics'|'settings';section?:'runtime'|'connection'|'device'|'account'|'source'|'network'|'notifications'|'appearance'|'about';platform?:'openai'|'claude'};
export type RecoveryContext = {from:NavigationTarget;target:NavigationTarget};
const sections:Record<NavigationTarget['page'],readonly string[]>={overview:['runtime','connection','device'],accounts:['account','source'],diagnostics:['runtime','connection','device','account','source','network'],settings:['network','notifications','appearance','about']};
export function validNavigationTarget(value:unknown):value is NavigationTarget {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['page','section','platform'].includes(k))||typeof v.page!=='string'||!Object.hasOwn(sections,v.page))return false;
 if(v.section!==undefined&&(typeof v.section!=='string'||!sections[v.page as NavigationTarget['page']].includes(v.section)))return false;
 return v.platform===undefined||(typeof v.platform==='string'&&['openai','claude'].includes(v.platform)&&(v.page==='accounts'||v.page==='diagnostics')&&(v.section===undefined||v.section==='account'||v.section==='source'));
}

export interface NavigationRequest {target:NavigationTarget;sequence:number}
export const settingsTabForSection={network:'network',notifications:'system',appearance:'general',about:'about'} as const;
export function navigationSelector(target:NavigationTarget):string {
 if(!validNavigationTarget(target))return '';
 if(target.page==='settings'&&target.section)return '[data-settings-section="'+target.section+'"]';
 if(target.page==='accounts'&&target.section==='source')return '[data-account-source="'+(target.platform??'openai')+'"] input';
 if(target.page==='accounts'&&target.platform)return '[data-account-platform="'+target.platform+'"]';
 if(target.page==='diagnostics'&&target.platform)return '[data-nav-section="'+(target.section??'account')+'"][data-nav-platform="'+target.platform+'"]';
 if(target.section)return '[data-nav-section="'+target.section+'"]';
 return '.page-heading h1';
}
