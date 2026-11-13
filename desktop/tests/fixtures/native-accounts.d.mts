export function accountFixture(platform:string):unknown;
export function installAccountFixture(input:{runtimeEnabled?:boolean;scenarios?:Record<string,unknown>;initialPreferences?:{language?:'system'|'zh'|'en';theme?:'system'|'light'|'dark'};accounts:{openai:unknown;claude:unknown}}):void;
