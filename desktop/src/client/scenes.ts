export const scenes = [
  'ready',
  'authorization-expired',
  'account-change',
  'quota-unknown',
  'removal-pending',
  'removal-unknown',
  'loading',
  'empty',
  'error',
  'unknown-tasks',
  'onboarding',
  'configured',
  'external',
  'offline',
  'unknown',
  'partial',
  'pending',
  'unknown-result',
  'operation-error',
] as const;
export type DemoScene = (typeof scenes)[number];
export function parseScene(scene: string): DemoScene {
  if ((scenes as readonly string[]).includes(scene)) return scene as DemoScene;
  throw new Error(`演示场景校验失败：实际场景=${scene}；允许场景=${scenes.join(', ')}。`);
}
export const debugToolsEnabled = import.meta.env.DEV || import.meta.env.MODE === 'e2e';
