import { Activity, House, Settings2, Users } from 'lucide-react';
import type { Page } from '../client/types';
export const navigation = [
  { id: 'overview', label: '概览', icon: House, description: '查看设备状态与贡献摘要。' },
  { id: 'accounts', label: 'AI 账号', icon: Users, description: '管理这台设备用于贡献的 AI 账号。' },
  { id: 'diagnostics', label: '诊断', icon: Activity, description: '检查 Bee 运行与连接状态。' },
  { id: 'settings', label: '设置', icon: Settings2, description: '管理设备偏好与应用设置。' },
] as const satisfies readonly { id: Page; label: string; icon: typeof Activity; description: string }[];
