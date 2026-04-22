/**
 * AKENG ERP — Phase 1 globálního UX standardu pro write akce (frontend-only).
 *
 * Tolerantní ke **současným** různým tvarům backend odpovědí (bez nového
 * jednotného kontraktu). Typické vstupy:
 *
 *   - HTTP 2xx + `{ status: "ok" }` / `{ ok: true }`
 *   - HTTP 2xx + `{ status: "soft_deleted", detail?: "..." }` → info
 *   - HTTP 2xx + `{ status: "created" | "updated" | … }` → success / info / warning podle mapy
 *   - HTTP 2xx + holý řetězec nebo nejednoznačný objekt → **ne** automaticky
 *     zelený success; chybově vypadající text zůstane **error**
 *   - HTTP 409 + `detail` → info pokud „už hotovo / storno“, jinak warning
 *   - HTTP 4xx/5xx + `detail` → error (kromě výše; status na Erroru volitelný přes `AkengErrorMeta`)
 *   - síť / neočekávaná výjimka → error
 *
 * Výstup: `{ kind: "success" | "info" | "warning" | "error", message: string }`.
 */

export type WriteFeedbackKind = "success" | "info" | "warning" | "error";

export interface WriteFeedback {
  kind: WriteFeedbackKind;
  message: string;
}

/**
 * Volitelná metadata, která mohou service wrappery připojit k vyhozenému
 * Erroru (např. `(err as Error & AkengErrorMeta).status = res.status`).
 * Není to vyžadováno — když chybí, použije se textová heuristika.
 */
export interface AkengErrorMeta {
  /** HTTP status code z odpovědi (pokud je k dispozici). */
  status?: number;
  /** Volitelný strukturovaný detail z backendu. */
  detail?: string;
}

/** Připojí HTTP status k `Error`, aby `interpretError` rozlišil 409 vs 403 atd. */
export function attachHttpErrorMeta(err: Error, res: Pick<Response, "status">): Error {
  (err as Error & AkengErrorMeta).status = res.status;
  return err;
}

/* ------------------------------------------------------------------ *
 * Status enum buckets — minimální, praktický rozsah.
 * Backend dnes vrací různé tvary; pokud `status` chybí, helper
 * spadne do generického success / error podle helper kontextu.
 * ------------------------------------------------------------------ */

const SUCCESS_STATUSES = new Set<string>([
  "created",
  "updated",
  "deleted",
  "cancelled",
  "canceled",
  "stornoed",
  "ok",
]);

const INFO_STATUSES = new Set<string>([
  "soft_deleted",
  "deactivated",
  "already_cancelled",
  "already_canceled",
  "already_done",
  "no_op",
  "noop",
  "skipped",
  "unchanged",
]);

const WARNING_STATUSES = new Set<string>([
  "blocked",
  "conflict",
  "needs_user_choice",
]);

/**
 * CZ heuristika pro detekci „už je stornováno / již deaktivováno"
 * v textu chybové hlášky. Slouží jako fallback, když nemáme HTTP status
 * a backend posílá jen volný `detail` v češtině.
 */
const ALREADY_DONE_PATTERNS: RegExp[] = [
  /již\s+(byl|bylo|je)?\s*stornov/iu,
  /uz\s+(byl|bylo|je)?\s*stornov/iu,
  /již\s+(byl|bylo|je)?\s*zruš/iu,
  /již\s+(byl|bylo|je)?\s*deaktivo/iu,
  /již\s+(byl|bylo|je)?\s*smazán/iu,
  /již\s+neexistuje/iu,
  /already\s+cancel/iu,
  /already\s+deleted/iu,
  /already\s+done/iu,
  /no[\s-]op/iu,
];

function looksAlreadyDone(message: string): boolean {
  if (!message) return false;
  return ALREADY_DONE_PATTERNS.some((re) => re.test(message));
}

/**
 * Text (message/detail/JSON string), který spíš znamená chybu než neutrální info.
 * Chrání před „zeleným“ úspěchem u nejednoznačných těl odpovědi.
 */
function looksErrorLike(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (/\b(http\s*)?4\d\d\b/.test(m) || /\b(http\s*)?5\d\d\b/.test(m)) return true;
  if (/\b409\b|\b403\b|\b401\b|\b422\b/.test(m)) return true;
  return [
    "chyba",
    "error",
    "failed",
    "failure",
    "nepodařil",
    "nepodaril",
    "neplatn",
    "invalid",
    "forbidden",
    "unauthorized",
    "denied",
    "permission",
    "oprávnění",
    "timeout",
    "network",
    "failed to fetch",
    "nesmí",
    "must not",
    "cannot",
    "unable",
    "blocked",
    "zakázán",
    "zamítnut",
  ].some((kw) => m.includes(kw));
}

function pickMessageFromBody(b: Record<string, unknown>): string | null {
  if (typeof b.message === "string" && b.message.trim()) return b.message.trim();
  if (typeof b.detail === "string" && b.detail.trim()) return b.detail.trim();
  if (typeof (b as { msg?: unknown }).msg === "string") {
    const v = (b as { msg: string }).msg.trim();
    if (v) return v;
  }
  return null;
}

function unknownStatusLooksErrorish(rawStatus: string): boolean {
  const s = rawStatus.toLowerCase();
  if (looksErrorLike(s)) return true;
  return /\b(fail|error|denied|invalid|rejected|abort)/i.test(s);
}

/**
 * Interpretuj parsované tělo úspěšné mutace (HTTP 2xx).
 *
 * Holý řetězec / nejednoznačný objekt **nesmí** implicitně znamenat úspěch
 * (zelený banner), pokud text nevypadá bezpečně.
 */
export function interpretMutationBody(
  body: unknown,
  fallbackSuccess: string,
): WriteFeedback {
  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return { kind: "success", message: fallbackSuccess };
    if (looksAlreadyDone(t)) return { kind: "info", message: t };
    if (looksErrorLike(t)) return { kind: "error", message: t };
    // Nejednoznačný text z API — raději info než success.
    return { kind: "info", message: t };
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    const rawStatus =
      typeof b.status === "string" ? b.status.trim().toLowerCase() : null;
    const bodyMessage = pickMessageFromBody(b);

    if (b.ok === false) {
      return { kind: "error", message: bodyMessage ?? "Operace neproběhla úspěšně." };
    }

    if (rawStatus) {
      if (INFO_STATUSES.has(rawStatus)) {
        return { kind: "info", message: bodyMessage ?? fallbackSuccess };
      }
      if (WARNING_STATUSES.has(rawStatus)) {
        return { kind: "warning", message: bodyMessage ?? fallbackSuccess };
      }
      if (SUCCESS_STATUSES.has(rawStatus)) {
        return { kind: "success", message: bodyMessage ?? fallbackSuccess };
      }
      if (unknownStatusLooksErrorish(rawStatus)) {
        return { kind: "error", message: bodyMessage ?? rawStatus };
      }
      if (bodyMessage && looksErrorLike(bodyMessage)) {
        return { kind: "error", message: bodyMessage };
      }
      return { kind: "success", message: bodyMessage ?? fallbackSuccess };
    }

    if (b.ok === true) {
      if (bodyMessage && looksErrorLike(bodyMessage)) {
        return { kind: "error", message: bodyMessage };
      }
      return { kind: "success", message: bodyMessage ?? fallbackSuccess };
    }

    // Objekt bez `status` / `ok` — zkusíme message/detail; chybový tón → error.
    if (bodyMessage) {
      if (looksAlreadyDone(bodyMessage)) return { kind: "info", message: bodyMessage };
      if (looksErrorLike(bodyMessage)) return { kind: "error", message: bodyMessage };
      return { kind: "info", message: bodyMessage };
    }
  }

  return { kind: "success", message: fallbackSuccess };
}

/**
 * Interpretuj vyhozenou chybu z mutace.
 *
 * Pravidla:
 * - 409 + text vypadá jako „už stornováno"  →  info (idempotent)
 * - 409 jinak                                 →  warning (business conflict)
 * - text vypadá jako „už stornováno" bez status →  info
 * - cokoliv jiného                            →  error
 */
export function interpretError(
  err: unknown,
  fallbackError: string,
): WriteFeedback {
  if (typeof err === "string") {
    const t = err.trim();
    const msg = t || fallbackError;
    if (looksAlreadyDone(msg)) return { kind: "info", message: msg };
    return { kind: "error", message: msg };
  }

  if (!(err instanceof Error)) {
    return { kind: "error", message: fallbackError };
  }

  const meta = err as Error & AkengErrorMeta;
  const status = typeof meta.status === "number" ? meta.status : null;
  const message = (err.message && err.message.trim()) || fallbackError;
  const idempotent = looksAlreadyDone(message);

  if (status === 409) {
    return idempotent
      ? { kind: "info", message }
      : { kind: "warning", message };
  }

  if (status != null && status >= 400 && status <= 499) {
    if (idempotent) return { kind: "info", message };
    return { kind: "error", message };
  }
  if (status != null && status >= 500) {
    return { kind: "error", message };
  }

  if (idempotent) {
    return { kind: "info", message };
  }

  const name = (err as Error).name;
  if (name === "TypeError" || /fetch/i.test(message)) {
    return { kind: "error", message: looksErrorLike(message) ? message : fallbackError };
  }

  return { kind: "error", message };
}

/**
 * Convenience runner: provede mutaci a vrátí normalizovaný feedback.
 *
 * Použití:
 *   const fb = await runWriteAction(
 *     () => stornoCustomerOrder(id),
 *     { successMessage: "Zakázka byla stornována.", errorMessage: "Storno se nezdařilo." }
 *   );
 *   setActionFeedback(fb);
 *
 * Pokud chcete na základě návratové hodnoty rozlišit (např. soft vs hard
 * delete), předejte `interpretResult` — vrátí buď konkrétní feedback,
 * nebo `null` pokud chcete spadnout do generického `interpretMutationBody`.
 */
export async function runWriteAction<T>(
  action: () => Promise<T>,
  options: {
    successMessage: string;
    errorMessage: string;
    interpretResult?: (result: T) => WriteFeedback | null;
  },
): Promise<WriteFeedback> {
  try {
    const result = await action();
    if (options.interpretResult) {
      const custom = options.interpretResult(result);
      if (custom) return custom;
    }
    return interpretMutationBody(result, options.successMessage);
  } catch (err) {
    return interpretError(err, options.errorMessage);
  }
}
