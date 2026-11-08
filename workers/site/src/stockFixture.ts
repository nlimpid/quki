import {
  dividendEventKind,
  exDateInYears,
  latestCashDividend,
  trailingCashYield,
  adjustedCashPerShare,
  type YieldEvent,
} from "@quki/analytics";
import {
  YIELD_NOTE,
  type AshareBoard,
  type AshareMarket,
  type DividendEventDto,
  type DividendYears,
  type StockDetailResponse,
  type StockListItem,
  type StockListQuery,
  type StockListResponse,
} from "@quki/types";

export const FIXTURE_AS_OF = "2026-11-08";
export const FIXTURE_AS_OF_ISO = "2026-11-08T07:30:00.000Z";

type FixtureEvent = YieldEvent & {
  cashPer10: number;
  profile: string;
  recordDate: string | null;
  noticeDate: string | null;
};

type FixtureCompany = {
  code: string;
  name: string;
  exchange: AshareMarket;
  board: AshareBoard;
  lastClose: number | null;
  quoteFresh: boolean;
  events: FixtureEvent[];
};

const book: FixtureCompany[] = [
  {
    code: "600519",
    name: "贵州茅台",
    exchange: "SH",
    board: "main",
    lastClose: 1678,
    quoteFresh: true,
    events: [
      {
        exDate: "2026-06-26",
        cashPerShare: 28.02423,
        cashPer10: 280.2423,
        bonusPer10: 0,
        transferPer10: 0,
        profile: "10派280.2423元(含税)",
        recordDate: "2026-06-25",
        noticeDate: "2026-06-22",
      },
      {
        exDate: "2025-12-19",
        cashPerShare: 23.957,
        cashPer10: 239.57,
        bonusPer10: 0,
        transferPer10: 0,
        profile: "10派239.57元(含税)",
        recordDate: "2025-12-18",
        noticeDate: "2025-12-11",
      },
      {
        exDate: "2024-06-19",
        cashPerShare: 30.876,
        cashPer10: 308.76,
        bonusPer10: 0,
        transferPer10: 0,
        profile: "10派308.76元(含税)",
        recordDate: "2024-06-18",
        noticeDate: "2024-06-12",
      },
    ],
  },
  {
    code: "000858",
    name: "五粮液",
    exchange: "SZ",
    board: "main",
    lastClose: 128.4,
    quoteFresh: true,
    events: [
      {
        exDate: "2026-07-09",
        cashPerShare: 5.022,
        cashPer10: 50.22,
        bonusPer10: 0,
        transferPer10: 0,
        profile: "10派50.22元(含税)",
        recordDate: "2026-07-08",
        noticeDate: "2026-06-30",
      },
    ],
  },
  {
    code: "000725",
    name: "京东方A",
    exchange: "SZ",
    board: "main",
    lastClose: 4.2,
    quoteFresh: true,
    events: [
      {
        exDate: "2026-06-18",
        cashPerShare: 0.056,
        cashPer10: 0.56,
        bonusPer10: 0,
        transferPer10: 0,
        profile: "10派0.56元(含税)",
        recordDate: "2026-06-17",
        noticeDate: "2026-06-12",
      },
      {
        exDate: "2011-06-20",
        cashPerShare: 0,
        cashPer10: 0,
        bonusPer10: 0,
        transferPer10: 2,
        profile: "10转2.00",
        recordDate: "2011-06-17",
        noticeDate: "2011-06-14",
      },
    ],
  },
  {
    code: "300750",
    name: "宁德时代",
    exchange: "SZ",
    board: "cyb",
    lastClose: null,
    quoteFresh: false,
    events: [
      {
        exDate: "2026-08-10",
        cashPerShare: 1.411,
        cashPer10: 14.11,
        bonusPer10: 0,
        transferPer10: 0,
        profile: "10派14.11元(含税)",
        recordDate: "2026-08-07",
        noticeDate: "2026-08-01",
      },
    ],
  },
  {
    code: "000001",
    name: "平安银行",
    exchange: "SZ",
    board: "main",
    lastClose: 11.2,
    quoteFresh: false,
    events: [
      {
        exDate: "2026-09-24",
        cashPerShare: 0.249,
        cashPer10: 2.49,
        bonusPer10: 0,
        transferPer10: 0,
        profile: "10派2.49元(含税,扣税后2.241元)",
        recordDate: "2026-09-23",
        noticeDate: "2026-09-17",
      },
    ],
  },
  {
    code: "000002",
    name: "示例转增",
    exchange: "SZ",
    board: "main",
    lastClose: 10,
    quoteFresh: true,
    events: [
      {
        exDate: "2026-03-01",
        cashPerShare: 1,
        cashPer10: 10,
        bonusPer10: 0,
        transferPer10: 10,
        profile: "10转10派10元(含税)",
        recordDate: "2026-02-27",
        noticeDate: "2026-02-20",
      },
    ],
  },
  {
    code: "688981",
    name: "中芯国际",
    exchange: "SH",
    board: "kcb",
    lastClose: 92.5,
    quoteFresh: true,
    events: [],
  },
];

function toItem(company: FixtureCompany): StockListItem {
  const yieldResult = trailingCashYield({
    events: company.events,
    price: company.lastClose,
    asOf: FIXTURE_AS_OF,
    quoteFresh: company.quoteFresh,
  });
  const latest = latestCashDividend(company.events);
  return {
    code: company.code,
    name: company.name,
    exchange: company.exchange,
    board: company.board,
    lastClose: company.lastClose,
    quoteFresh: company.quoteFresh,
    trailingYieldPct: yieldResult.yieldPct,
    ttmCashPerShare: company.events.length === 0 ? 0 : yieldResult.ttmCashPerShare,
    lastCashDivDate: latest?.exDate ?? null,
    lastCashPer10: latest?.cashPer10 ?? null,
  };
}

const items = book.map(toItem);

function matches(item: StockListItem, query: StockListQuery): boolean {
  if (query.market === "BJ") return false;
  if (query.market === "SH" || query.market === "SZ") {
    if (item.exchange !== query.market) return false;
  }
  const q = query.q?.trim();
  if (q && !item.code.includes(q) && !item.name.includes(q)) return false;
  return true;
}

export async function listFixtureStocks(query: StockListQuery): Promise<StockListResponse> {
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const filtered = items.filter((item) => matches(item, query));
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "yield") {
      if (a.trailingYieldPct == null && b.trailingYieldPct == null)
        return a.code.localeCompare(b.code);
      if (a.trailingYieldPct == null) return 1;
      if (b.trailingYieldPct == null) return -1;
      if (a.trailingYieldPct !== b.trailingYieldPct) return b.trailingYieldPct - a.trailingYieldPct;
    }
    if (query.sort === "lastDivDate") {
      if (a.lastCashDivDate == null && b.lastCashDivDate == null)
        return a.code.localeCompare(b.code);
      if (a.lastCashDivDate == null) return 1;
      if (b.lastCashDivDate == null) return -1;
      if (a.lastCashDivDate !== b.lastCashDivDate)
        return b.lastCashDivDate.localeCompare(a.lastCashDivDate);
    }
    return a.code.localeCompare(b.code);
  });
  return {
    asOf: FIXTURE_AS_OF_ISO,
    total: filtered.length,
    page,
    pageSize,
    isSample: true,
    yieldNote: YIELD_NOTE,
    items: sorted.slice((page - 1) * pageSize, page * pageSize),
  };
}

export async function getFixtureStock(
  code: string,
  years: DividendYears,
): Promise<StockDetailResponse | null> {
  const company = book.find((item) => item.code === code);
  const item = items.find((entry) => entry.code === code);
  if (!company || !item) return null;
  const events: DividendEventDto[] = company.events.flatMap((event) => {
    if (!exDateInYears(event.exDate, FIXTURE_AS_OF, years)) return [];
    return [
      {
        id: `${company.code}-${event.exDate}`,
        code: company.code,
        eventType: dividendEventKind(event),
        reportDate: null,
        noticeDate: event.noticeDate,
        recordDate: event.recordDate,
        exDate: event.exDate,
        payDate: null,
        cashPer10: event.cashPer10 > 0 ? event.cashPer10 : null,
        bonusPer10: event.bonusPer10 > 0 ? event.bonusPer10 : null,
        transferPer10: event.transferPer10 > 0 ? event.transferPer10 : null,
        adjustedCashPerShare:
          event.cashPerShare > 0 ? adjustedCashPerShare(event, company.events) : null,
        profile: event.profile,
      },
    ];
  });
  return {
    company: { ...item, secucode: `${item.code}.${item.exchange}` },
    asOf: FIXTURE_AS_OF_ISO,
    yieldAsOf: FIXTURE_AS_OF,
    years,
    isSample: true,
    yieldNote: YIELD_NOTE,
    events,
  };
}

export async function lookupFixtureStocks(codes: readonly string[]): Promise<StockListItem[]> {
  const wanted = codes.filter((code) => /^\d{6}$/.test(code)).slice(0, 50);
  return wanted.flatMap((code) => {
    const item = items.find((entry) => entry.code === code);
    return item ? [item] : [];
  });
}
