import type { Verdict } from "./schemas/index";
import {
  RECEIPT_SCHEMA_VERSION,
  VERDICT_LABELS,
  VERDICT_QUALIFIER,
} from "./schemas/index";

export const PRODUCT_NAME = "Agent Receipt";
export { RECEIPT_SCHEMA_VERSION };

export const TRUST_STATEMENT =
  "Rules establish what happened relative to authority; Granite explains the verified result to a human.";

export { VERDICT_LABELS };

export function qualifyVerdict(verdict: Verdict): string {
  return `${VERDICT_LABELS[verdict]}. ${VERDICT_QUALIFIER}`;
}
