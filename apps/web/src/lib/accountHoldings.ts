import { bearerHeader } from "./authClient.js";

export type AccountHolding = {
  code: string;
  shares: number;
  updatedAt: string;
  version: string;
};

/** Account rows are shown only for the Clerk session key that the Worker already confirmed. */
export function showAccountBook(input: {
  phaseKind: string;
  sessionKey: string;
  confirmedSessionKey: string | null;
}): boolean {
  return input.phaseKind === "authenticated" && input.confirmedSessionKey === input.sessionKey;
}

/** A list response belongs to the screen only if that session key is still current. */
export function acceptAccountList(input: {
  cancelled: boolean;
  requestedKey: string;
  currentKey: string;
}): boolean {
  return !input.cancelled && input.requestedKey === input.currentKey;
}

/** Account rows leave the screen when the session ends. The browser book is a different value. */
export function visibleAccountHoldings(
  signedIn: boolean,
  items: AccountHolding[] | null,
): AccountHolding[] | null {
  return signedIn ? items : null;
}

export class AccountHoldingsError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "AccountHoldingsError";
    this.status = status;
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : "账户持仓没有保存";
}

function parseHolding(value: unknown): AccountHolding {
  if (!value || typeof value !== "object") throw new AccountHoldingsError("账户持仓没有保存");
  const row = value as Record<string, unknown>;
  if (
    typeof row.code !== "string" ||
    typeof row.shares !== "number" ||
    typeof row.updatedAt !== "string" ||
    typeof row.version !== "string"
  ) {
    throw new AccountHoldingsError("账户持仓没有保存");
  }
  return {
    code: row.code,
    shares: row.shares,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/** Create when the account has no row for this code. Otherwise send that row's version. */
export function expectedVersionForSave(
  items: AccountHolding[] | null,
  code: string,
): string | null {
  return items?.find((item) => item.code === code)?.version ?? null;
}

export function accountRowsAfterSave(
  items: AccountHolding[] | null,
  row: AccountHolding,
): AccountHolding[] {
  return [...(items ?? []).filter((item) => item.code !== row.code), row].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

export function accountRowsAfterDelete(
  items: AccountHolding[] | null,
  code: string,
): AccountHolding[] {
  return (items ?? []).filter((item) => item.code !== code);
}

export async function readAccountHoldings(token: string | null): Promise<AccountHolding[]> {
  if (!token) throw new AccountHoldingsError("需要登录");
  const response = await fetch("/api/holdings", {
    credentials: "same-origin",
    headers: bearerHeader(token),
  });
  if (!response.ok) throw new AccountHoldingsError(await readError(response));
  const body = (await response.json()) as { items?: unknown };
  if (!Array.isArray(body.items)) throw new AccountHoldingsError("账户持仓没有保存");
  return body.items.map((item) => parseHolding(item));
}

export async function writeAccountHoldings(
  item: { code: string; shares: number; expectedVersion: string | null },
  token: string | null,
): Promise<AccountHolding> {
  if (!token) throw new AccountHoldingsError("需要登录");
  const response = await fetch("/api/holdings", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...bearerHeader(token) },
    body: JSON.stringify({
      code: item.code,
      shares: item.shares,
      expectedVersion: item.expectedVersion,
    }),
  });
  if (!response.ok) throw new AccountHoldingsError(await readError(response), response.status);
  return parseHolding(await response.json().catch(() => null));
}

export async function deleteAccountHolding(
  code: string,
  expectedVersion: string,
  token: string | null,
): Promise<void> {
  if (!token) throw new AccountHoldingsError("需要登录");
  const response = await fetch(`/api/holdings/${encodeURIComponent(code)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...bearerHeader(token) },
    body: JSON.stringify({ expectedVersion }),
  });
  if (!response.ok) throw new AccountHoldingsError(await readError(response), response.status);
}
