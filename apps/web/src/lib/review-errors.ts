import { isTRPCClientError } from "@trpc/client";

import type { AppRouter } from "@prostapaper/api";

import { errorMessage } from "#lib/error-message";

const SERVICE_MESSAGES: Record<string, string> = {
  "Review revision or mapping has changed; reload before saving":
    "Revize se mezitím změnila. Váš vstup zůstal zachován; porovnejte aktuální stav a akci zopakujte.",
  "Review is not editable": "Kontrola už není otevřená pro úpravy. Záznam byl mezitím schválen nebo odeslán.",
  "Save a review revision before making decisions": "Nejprve uložte revizi kontroly.",
  "Save a pinned review revision before approval": "Před schválením uložte revizi kontroly.",
  "Complete valid field, source-mark and section review before approval":
    "Před schválením vyřešte chyby, označená pole, značky schémat a potvrďte všechny sekce.",
  "Correct validation issues before resolving this field": "Nejprve opravte chyby validace tohoto pole.",
  "A note is required for conflicts and manual corrections": "U oprav a rozporů je nutné odůvodnění.",
  "Resolve validation, flagged fields and source marks before confirming the section":
    "Před potvrzením sekce vyřešte chyby, označená pole a značky schémat.",
  "Review draft contains invalid fields or too many lesions": "Záznam obsahuje neplatné hodnoty.",
  "Request ID was already used for a different save":
    "Požadavek byl již použit pro jinou změnu. Akci zopakujte.",
  "Lesion identity already used": "Toto ložisko už existuje. Obnovte stav a zkuste to znovu.",
  "Case mapping is not complete": "Mapování případu ještě není dokončeno.",
};
const CONFLICT_MESSAGE =
  "Revize se mezitím změnila. Váš vstup zůstal zachován; porovnejte aktuální stav a akci zopakujte.";

/** Czech feedback for review input and mutations; keeps typed input instead of asking for a reload. */
export function reviewErrorMessage(error: unknown): string {
  if (isTRPCClientError<AppRouter>(error)) {
    const translated = SERVICE_MESSAGES[error.message];
    if (translated !== undefined) return translated;
    if (error.data?.code === "CONFLICT") return CONFLICT_MESSAGE;

    return errorMessage(error);
  }
  if (error instanceof Error && error.name === "ZodError")
    return "Hodnota má neplatný typ nebo je mimo povolený rozsah.";
  if (error instanceof Error && error.name !== "TimeoutError") return error.message;

  return errorMessage(error);
}
