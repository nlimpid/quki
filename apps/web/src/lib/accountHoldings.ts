export type AccountHolding = {
  code: string;
  shares: number;
  updatedAt: string;
  version: string;
};

/** Account rows leave the screen when the session ends. The browser book is a different value. */
export function visibleAccountHoldings(
  signedIn: boolean,
  items: AccountHolding[] | null,
): AccountHolding[] | null {
  return signedIn ? items : null;
}

export class AccountHoldingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountHoldingsError";
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : "账户持仓没有保存";
}

export async function readAccountHoldings(): Promise<AccountHolding[]> {
  const response = await fetch("/api/holdings", { credentials: "same-origin" });
  if (!response.ok) throw new AccountHoldingsError(await readError(response));
  const body = (await response.json()) as { items?: unknown };
  if (!Array.isArray(body.items)) throw new AccountHoldingsError("账户持仓没有保存");
  return body.items.map((item) => {
    if (!item || typeof item !== "object") throw new AccountHoldingsError("账户持仓没有保存");
    const row = item as Record<string, unknown>;
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
  });
}

export async function writeAccountHoldings(
  item: { code: string; shares: number; expectedVersion: string | null },
  csrfToken: string,
): Promise<void> {
  const response = await fetch("/api/holdings", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({
      csrf: csrfToken,
      code: item.code,
      shares: item.shares,
      expectedVersion: item.expectedVersion,
    }),
  });
  if (!response.ok) throw new AccountHoldingsError(await readError(response));
}

export async function deleteAccountHolding(
  code: string,
  expectedVersion: string,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(`/api/holdings/${encodeURIComponent(code)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ csrf: csrfToken, expectedVersion }),
  });
  if (!response.ok) throw new AccountHoldingsError(await readError(response));
}
