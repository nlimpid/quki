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
  /** Not restored. A previous confirmation is not permission to write again. */
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

function withoutAuthorization(screenshot: ScreenshotUiDraft): ScreenshotUiDraft {
  return {
    draftId: screenshot.draftId,
    sourceRows: screenshot.sourceRows.map((row) => ({ ...row })),
    catalog: screenshot.catalog.map((row) => ({ ...row })),
    explicit: false,
    edits: screenshot.edits.map((edit) => ({
      include: edit.include,
      shares: edit.shares,
      nameConfirmed: false,
      unknownConfirmed: false,
      sharesConfirmed: false,
    })),
  };
}

export function saveAccountUiDraft(draft: AccountUiDraft): void {
  if (draft.userId.length === 0) return;
  drafts.set(draft.userId, {
    userId: draft.userId,
    code: draft.code,
    shares: draft.shares,
    replacePrompt: null,
    localChanges: draft.localChanges?.map((row) => ({ ...row })) ?? null,
    preserved: draft.preserved.map((row) => ({ ...row })),
    screenshot: draft.screenshot ? withoutAuthorization(draft.screenshot) : null,
  });
}

export function readAccountUiDraft(userId: string): AccountUiDraft | null {
  const found = drafts.get(userId);
  if (!found || found.userId !== userId) return null;
  return {
    ...found,
    replacePrompt: null,
    screenshot: found.screenshot ? withoutAuthorization(found.screenshot) : null,
  };
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
