import { en } from './en.ts';
export const zh: Record<string, string> = Object.fromEntries(Object.keys(en).map(key => [key, key]));
