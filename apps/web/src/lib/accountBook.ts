import { useEffect, useRef, useState } from "react";

import {
  AccountHoldingsError,
  accountRowsAfterDelete,
  accountRowsAfterSave,
  deleteAccountHolding,
  readAccountHoldings,
  writeAccountHoldings,
  type AccountHolding,
} from "./accountHoldings.js";

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
  run: (token: string) => Promise<unknown>,
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
  write?: typeof writeAccountHoldings;
  remove?: typeof deleteAccountHolding;
}) {
  const {
    sessionKey,
    signedIn,
    accessToken,
    read = readAccountHoldings,
    write = writeAccountHoldings,
    remove = deleteAccountHolding,
  } = input;
  const { epoch, epochRef } = useAccountClock(sessionKey);
  const accessTokenRef = useRef(accessToken);
  const readRef = useRef(read);
  const writeRef = useRef(write);
  const removeRef = useRef(remove);
  useEffect(() => {
    accessTokenRef.current = accessToken;
    readRef.current = read;
    writeRef.current = write;
    removeRef.current = remove;
  });
  const [items, setItems] = useState<AccountHolding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownEpoch, setShownEpoch] = useState(epoch);
  const inflight = useRef<number | null>(null);
  const [busyTicket, setBusyTicket] = useState<number | null>(null);
  if (busyTicket != null && busyTicket !== epoch) {
    setBusyTicket(null);
  }
  useEffect(() => {
    if (inflight.current != null && inflight.current !== epoch) inflight.current = null;
  }, [epoch]);
  const [drawer, setDrawer] = useState<{ code: string; shares: number; ticket: number } | null>(
    null,
  );
  const [editor, setEditor] = useState<{
    code: string;
    shares: string;
    expectedVersion: string | null;
    ticket: number;
  } | null>(null);
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
  if (editor && editor.ticket !== epoch) {
    setEditor(null);
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

  function currentEnough(ticket: number): boolean {
    return epochRef.current === ticket;
  }

  function begin(ticket: number): boolean {
    if (inflight.current != null) return false;
    inflight.current = ticket;
    setBusyTicket(ticket);
    return true;
  }

  function finish(ticket: number) {
    if (inflight.current === ticket) inflight.current = null;
    if (!currentEnough(ticket)) return;
    setBusyTicket((current) => (current === ticket ? null : current));
  }

  async function save(change: {
    ticket: number;
    code: string;
    shares: number;
    expectedVersion: string | null;
  }): Promise<"written" | "dropped" | "conflict" | "failed"> {
    if (!begin(change.ticket)) return "dropped";
    const saved = { row: null as AccountHolding | null };
    try {
      const result = await commit(change.ticket, async (token) => {
        saved.row = await writeRef.current(
          {
            code: change.code,
            shares: change.shares,
            expectedVersion: change.expectedVersion,
          },
          token,
        );
      });
      if (result !== "written" || !saved.row || !currentEnough(change.ticket)) return "dropped";
      const row = saved.row;
      setItems((prev) => accountRowsAfterSave(prev, row));
      setError(null);
      setEditor(null);
      return "written";
    } catch (failure) {
      if (!currentEnough(change.ticket)) return "dropped";
      if (failure instanceof AccountHoldingsError && failure.status === 409) {
        setError(failure.message);
        return "conflict";
      }
      setError(failure instanceof Error ? failure.message : "账户持仓没有保存");
      return "failed";
    } finally {
      finish(change.ticket);
    }
  }

  async function removeRow(
    ticket: number,
    code: string,
    expectedVersion: string,
  ): Promise<"written" | "dropped" | "conflict" | "failed"> {
    if (!begin(ticket)) return "dropped";
    try {
      const result = await commit(ticket, (token) =>
        removeRef.current(code, expectedVersion, token),
      );
      if (result !== "written" || !currentEnough(ticket)) return "dropped";
      setItems((prev) => accountRowsAfterDelete(prev, code));
      setError(null);
      return "written";
    } catch (failure) {
      if (!currentEnough(ticket)) return "dropped";
      if (failure instanceof AccountHoldingsError && failure.status === 409) {
        setError(failure.message);
        return "conflict";
      }
      setError(failure instanceof Error ? failure.message : "账户持仓没有保存");
      return "failed";
    } finally {
      finish(ticket);
    }
  }

  function commit(ticket: number, run: (token: string) => Promise<unknown>) {
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
    busy: busyTicket === epoch,
    items: signedIn ? items : null,
    error: signedIn ? error : null,
    drawer,
    openDrawer(code: string, shares: number) {
      setDrawer({ code, shares, ticket: epoch });
    },
    closeDrawer() {
      setDrawer(null);
    },
    saveDrawer(
      run: (token: string, selection: { code: string; shares: number }) => Promise<unknown>,
    ) {
      if (!drawer || drawer.ticket !== epoch) return Promise.resolve("dropped" as const);
      const selection = { code: drawer.code, shares: drawer.shares };
      const ticket = drawer.ticket;
      return commit(ticket, (token) => run(token, selection));
    },
    commit,
    editor: editor && editor.ticket === epoch ? editor : null,
    openEditor(next: { code: string; shares: string; expectedVersion: string | null }) {
      setEditor({ ...next, ticket: epoch });
    },
    setEditorCode(code: string) {
      setEditor((current) =>
        current && current.expectedVersion == null ? { ...current, code } : current,
      );
    },
    setEditorShares(shares: string) {
      setEditor((current) => (current ? { ...current, shares } : current));
    },
    submitEditor() {
      if (!editor || editor.ticket !== epoch) return Promise.resolve("dropped" as const);
      return save({
        ticket: editor.ticket,
        code: editor.code,
        shares: Number(editor.shares),
        expectedVersion: editor.expectedVersion,
      });
    },
    removeRow,
    save,
  };
}
