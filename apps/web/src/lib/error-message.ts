import { isTRPCClientError } from "@trpc/client";

import type { AppRouter } from "@prostapaper/api";

const GENERIC_ERROR_MESSAGE = "Něco se pokazilo. Zkuste to znovu.";
const NETWORK_ERROR_MESSAGE = "Server není dostupný. Zkontrolujte připojení.";
const TIMEOUT_MESSAGE = "Server neodpověděl včas. Zkuste to znovu.";

const TRPC_CODE_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Neplatný požadavek. Zkontrolujte zadané údaje.",
  UNAUTHORIZED: "Nejste přihlášeni. Přihlaste se znovu.",
  FORBIDDEN: "K této akci nemáte oprávnění.",
  NOT_FOUND: "Požadovaný záznam nebyl nalezen.",
  CONFLICT: "Záznam mezitím změnil někdo jiný. Obnovte stránku.",
  PRECONDITION_FAILED: "Služba není nakonfigurována. Kontaktujte správce.",
  PAYLOAD_TOO_LARGE: "Soubor je příliš velký.",
  TOO_MANY_REQUESTS: "Příliš mnoho požadavků. Zkuste to za chvíli znovu.",
  TIMEOUT: TIMEOUT_MESSAGE,
};

const AUTH_CODE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Přihlášení selhalo. Zkontrolujte e-mail a heslo.",
  USER_ALREADY_EXISTS: "Účet s tímto e-mailem už existuje. Přihlaste se.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Účet s tímto e-mailem už existuje. Přihlaste se.",
  PASSWORD_TOO_SHORT: "Heslo musí mít 8 až 128 znaků.",
  PASSWORD_TOO_LONG: "Heslo musí mít 8 až 128 znaků.",
  INVALID_EMAIL: "Zadejte platnou e-mailovou adresu.",
  INVALID_NAME: "Zadejte své jméno.",
  TOO_MANY_REQUESTS: "Příliš mnoho pokusů. Zkuste to za chvíli znovu.",
};

export function errorMessage(error: unknown): string {
  if (isTRPCClientError<AppRouter>(error)) {
    const code = error.data?.code;
    if (code === undefined) return NETWORK_ERROR_MESSAGE;

    return AUTH_CODE_MESSAGES[error.message] ?? TRPC_CODE_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE;
  }
  if (error instanceof Error && error.name === "TimeoutError") return TIMEOUT_MESSAGE;

  return GENERIC_ERROR_MESSAGE;
}
