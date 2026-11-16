import type { VisionRow } from "@quki/analytics";

export type ScreenshotEdit = {
  include: boolean;
  shares: string;
  nameConfirmed: boolean;
  unknownConfirmed: boolean;
  sharesConfirmed: boolean;
};

export type ScreenshotUiDraft = {
  draftId: string;
  sourceRows: VisionRow[];
  catalog: { code: string; name: string }[];
  edits: ScreenshotEdit[];
  explicit: boolean;
};

export type AccountUiDraft = {
  userId: string;
  code: string;
  shares: string;
  replacePrompt: { code: string; previousShares: number; nextShares: number } | null;
  localChanges: { code: string; shares: number; previousShares: number | null }[] | null;
  preserved: { code: string; shares: number }[];
  screenshot: ScreenshotUiDraft | null;
};

const drafts = new Map<string, AccountUiDraft>();
let guestDrawer: { code: string; shares: string } | null = null;

export function saveAccountUiDraft(draft: AccountUiDraft): void {
  if (draft.userId.length === 0) return;
  drafts.set(draft.userId, {
    ...draft,
    localChanges: draft.localChanges?.map((row) => ({ ...row })) ?? null,
    preserved: draft.preserved.map((row) => ({ ...row })),
    screenshot: draft.screenshot
      ? {
          ...draft.screenshot,
          sourceRows: draft.screenshot.sourceRows.map((row) => ({ ...row })),
          catalog: draft.screenshot.catalog.map((row) => ({ ...row })),
          edits: draft.screenshot.edits.map((row) => ({ ...row })),
        }
      : null,
  });
}

export function readAccountUiDraft(userId: string): AccountUiDraft | null {
  const found = drafts.get(userId);
  if (!found || found.userId !== userId) return null;
  return found;
}

export function accountDraftOwnedBy(draft: AccountUiDraft | null, userId: string): boolean {
  return draft != null && draft.userId === userId;
}

export function readGuestDrawerDraft(): { code: string; shares: string } | null {
  return guestDrawer ? { ...guestDrawer } : null;
}

export function writeGuestDrawerDraft(drawer: { code: string; shares: string } | null): void {
  guestDrawer = drawer ? { code: drawer.code, shares: drawer.shares } : null;
}

export function clearUiDraftsForTests(): void {
  drafts.clear();
  guestDrawer = null;
}
