import { toBeeError } from "./bee";
import type { Explained } from "../app/context";
import type { Messages } from "./i18n";

/**
 * Why a request failed, in the person's words, and its code for the
 * technical details. Bee's explanations and the generic fallback already say
 * what to do; `known` is false only when Bee could not be reached at all.
 */
export function describeError(err: unknown, explain: (code: string) => Explained, t: Messages): { text: string; code: string; known: boolean } {
  const e = toBeeError(err);
  if (e.status === 0) return { text: t.errors.unreachable, code: e.code, known: false };
  const known = explain(e.code);
  return { text: known.known ? known.cause : t.errors.tryAgain, code: e.code, known: true };
}
