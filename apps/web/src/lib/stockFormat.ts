import type { DividendEventKind, PortfolioWeight } from "@quki/types";

const priceFormat = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const per10Format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });
const yieldFormat = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const shareFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

export function formatPrice(value: number | null | undefined): string {
  return value == null ? "—" : priceFormat.format(value);
}

export function formatCny(value: number | null | undefined): string {
  return value == null ? "—" : `¥${priceFormat.format(value)}`;
}

export function formatShares(value: number): string {
  return shareFormat.format(value);
}

export function formatPer10(value: number | null | undefined): string {
  return value == null ? "—" : per10Format.format(value);
}

export function formatYield(value: number | null | undefined): string {
  return value == null ? "—" : `${yieldFormat.format(value)}%`;
}

export function formatBeijing(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

export function weightLabel(weight: PortfolioWeight): string {
  if (weight === "equal") return "等权（缺物价）";
  if (weight === "partial") return "部分缺价格，按有价持仓市值加权";
  return "市值加权";
}

export function eventBadges(
  kind: DividendEventKind,
  bonus: number | null,
  transfer: number | null,
  cash: number | null,
): { kind: string; label: string }[] {
  if (kind === "mixed") {
    const badges: { kind: string; label: string }[] = [];
    if (cash != null) badges.push({ kind: "cash", label: "现金" });
    if (bonus != null) badges.push({ kind: "bonus", label: "送股" });
    if (transfer != null) badges.push({ kind: "transfer", label: "转增" });
    return badges;
  }
  if (kind === "bonus") return [{ kind: "bonus", label: "送股" }];
  if (kind === "transfer") return [{ kind: "transfer", label: "转增" }];
  return [{ kind: "cash", label: "现金" }];
}
