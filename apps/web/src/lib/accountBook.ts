import { useEffect, useRef, useState } from "react";

import { readAccountHoldings, type AccountHolding } from "./accountHoldings.js";

export type AccountClock = {
  note(sessionKey: string): number;
  current(): number;
  still(ticket: number): boolean;
};

/** Epoch advances on every session-key change, including a return to an earlier account. */
export function createAccountClock(): AccountClock {
  let epoch = 0;
  let key: string | null = null;
  return {
    note(sessionKey) {
      if (key !== sessionKey) {
        key = sessionKey;
        epoch += 1;
      }
      return epoch;
    },
    current() {
      return epoch;
    },
    still(ticket) {
      return ticket === epoch;
    },
  };
}

export function useAccountClock(sessionKey: string): {
  epoch: number;
  epochRef: { readonly current: number };
} {
  const [state, setState] = useState({ key: sessionKey, epoch: 1 });
  if (state.key !== sessionKey) {
    setState({ key: sessionKey, epoch: state.epoch + 1 });
  }
  const epoch = state.key === sessionKey ? state.epoch : state.epoch + 1;
  const epochRef = useRef(epoch);
  useEffect(() => {
    epochRef.current = epoch;
  }, [epoch]);
  return { epoch, epochRef };
}

export async function commitAccountChange(
  clock: AccountClock,
  accessToken: () => Promise<string | null>,
  ticket: number,
  run: (token: string) => Promise<void>,
): Promise<"written" | "dropped"> {
  const token = await accessToken();
  if (!clock.still(ticket) || !token) return "dropped";
  await run(token);
  return "written";
}

export function useAccountBook(input: {
  sessionKey: string;
  signedIn: boolean;
  accessToken: () => Promise<string | null>;
  read?: (token: string | null) => Promise<AccountHolding[]>;
}) {
  const { sessionKey, signedIn, accessToken, read = readAccountHoldings } = input;
  const { epoch, epochRef } = useAccountClock(sessionKey);
  const accessTokenRef = useRef(accessToken);
  const readRef = useRef(read);
  useEffect(() => {
    accessTokenRef.current = accessToken;
    readRef.current = read;
  });
  const [items, setItems] = useState<AccountHolding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownEpoch, setShownEpoch] = useState(epoch);
  const [drawer, setDrawer] = useState<{ code: string; shares: number; ticket: number } | null>(
    null,
  );
  if (shownEpoch !== epoch) {
    setShownEpoch(epoch);
    setItems(null);
    setError(null);
  }
  if (!signedIn && (items != null || error != null)) {
    setItems(null);
    setError(null);
  }
  if (drawer && drawer.ticket !== epoch) {
    setDrawer(null);
  }

  useEffect(() => {
    if (!signedIn) return;
    const started = epoch;
    const gate = { cancelled: false };
    void accessTokenRef
      .current()
      .then((token) => readRef.current(token))
      .then((rows) => {
        if (gate.cancelled || epochRef.current !== started) return;
        setItems(rows);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (gate.cancelled || epochRef.current !== started) return;
        setError(reason instanceof Error ? reason.message : "账户持仓没有读取成功");
      });
    return () => {
      gate.cancelled = true;
    };
  }, [epoch, epochRef, sessionKey, signedIn]);

  function commit(ticket: number, run: (token: string) => Promise<void>) {
    return commitAccountChange(
      {
        note: () => epochRef.current,
        current: () => epochRef.current,
        still: (started) => started === epochRef.current,
      },
      () => accessTokenRef.current(),
      ticket,
      run,
    );
  }

  return {
    epoch,
    items: signedIn ? items : null,
    error: signedIn ? error : null,
    drawer,
    openDrawer(code: string, shares: number) {
      setDrawer({ code, shares, ticket: epoch });
    },
    closeDrawer() {
      setDrawer(null);
    },
    saveDrawer(run: (token: string, selection: { code: string; shares: number }) => Promise<void>) {
      if (!drawer || drawer.ticket !== epoch) return Promise.resolve("dropped" as const);
      const selection = { code: drawer.code, shares: drawer.shares };
      const ticket = drawer.ticket;
      return commit(ticket, (token) => run(token, selection));
    },
    commit,
  };
}
