import { en } from './en';
export const zh: Record<string, string> = Object.fromEntries(Object.keys(en).map(key => [key, key]));
