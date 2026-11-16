import type { DividendReference } from "@quki/analytics";

export type AccountHoldingItem = {
  code: string;
  shares: number;
  updatedAt: string;
};

export type AccountHoldingsResponse = {
  items: AccountHoldingItem[];
  reference: DividendReference;
  visionConfigured: boolean;
  imageDisclosure: string;
  replayed?: boolean;
};

export class HoldingsRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("holdings_request_failed");
    this.status = status;
  }
}

export async function fetchAccountHoldings(
  fetchImpl: typeof fetch = fetch,
): Promise<AccountHoldingsResponse> {
  const response = await fetchImpl("/api/holdings", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new HoldingsRequestError(response.status);
  return (await response.json()) as AccountHoldingsResponse;
}

export async function writeAccountHoldings(
  input: {
    path: "/api/holdings" | "/api/holdings/import";
    csrfToken: string;
    idempotencyKey: string;
    items: { code: string; shares: number }[];
    confirmEmpty?: boolean;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<AccountHoldingsResponse> {
  const response = await fetchImpl(input.path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-csrf-token": input.csrfToken,
    },
    body: JSON.stringify({
      csrf: input.csrfToken,
      idempotencyKey: input.idempotencyKey,
      items: input.items,
      confirmEmpty: input.confirmEmpty === true,
    }),
  });
  if (!response.ok) throw new HoldingsRequestError(response.status);
  return (await response.json()) as AccountHoldingsResponse;
}
