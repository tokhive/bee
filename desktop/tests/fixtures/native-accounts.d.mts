import type {DesktopPreferences} from '../../src/system/preferences';
export function accountFixture(platform:string):unknown;
export function installAccountFixture(input:{runtimeEnabled?:boolean;scenarios?:Record<string,unknown>;initialPreferences?:Partial<DesktopPreferences>;accounts:{openai:unknown;claude:unknown}}):void;
