import { useEffect, useState } from 'react';
import type { Preferences } from '../client/types';
import { en } from './en';
import { zh } from './zh';
export const missingTranslations = new Set<string>();
let language: 'zh' | 'en' = 'zh';
/** Presentation only: callers pass visible copy, never input values, IDs, URLs or money. */
export function t<T>(value: T, params?: Record<string, string | number>): T {
  if (typeof value !== 'string') return value;
  const result = language === 'zh' ? (zh[value] ?? value) : (en[value] ?? value.replace(/[\u4e00-\u9fff]+/g, phrase => {
    if (!(phrase in en)) missingTranslations.add(phrase);
    return en[phrase] ?? phrase;
  })).replace(/[，。；：？（）、]/g, mark => ({ '，': ', ', '。': '.', '；': '; ', '：': ': ', '？': '?', '（': '(', '）': ')', '、': ', ' })[mark]!);
  return (params ? result.replace(/\{(\w+)\}/g, (match, key) => String(params[key] ?? match)) : result) as T;
}
export function useLanguage(preference: Preferences['language']) {
  const [, update] = useState(0);
  useEffect(() => {
    const changed = () => update(n => n + 1);
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, []);
  language = preference === 'system' ? (navigator.language.startsWith('zh') ? 'zh' : 'en') : preference;
  document.documentElement.lang = language;
  return language;
}
