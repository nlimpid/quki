# quki.cc — Phase 1 Design Spec (Implementation-Ready)

> Product: Chinese index valuation / timing tool  
> Phase 1 instruments: **红利低波 H30269**, **中证红利 000922**  
> Audience: implementers (cloud coding agent on `github.com/nlimpid/quki`)  
> Aesthetic: calm, data-dense, trustworthy finance tool — clean, not flashy  
> Copy language: **Simplified Chinese**  
> Tokens: see `tokens.json` / `tokens.css`  
> Mockups: `mockups/` + rendered PNGs in this folder

---

## 0. Stack alignment & recommendations

### Repo status (checked 2026-11-04 Asia/Shanghai)

- Public `github.com/nlimpid/quki` currently contains an **old Go** project (“question’s wikipedia”, last push ~2020). Branches `master` / `develop` / `structure` have **no React, Tailwind, chart library, or Cloudflare Workers config**.
- `/workspace/quki-handoff/db/` was empty — no prior agent notes to align with.
- **Assumption:** the React + Cloudflare Workers rewrite is forthcoming; this spec is the UI contract for that rewrite.

### Recommended stack (if greenfield)

| Layer | Choice | Why |
|-------|--------|-----|
| UI | **React 19 + TypeScript + Vite 6** | Matches brief; fast Workers-compatible builds |
| Deploy | **Cloudflare Workers** via `@cloudflare/vite-plugin` + Wrangler | SPA or Workers SSR |
| Styling | **Tailwind CSS v4** + CSS variables from `tokens.css` | Utility speed; tokens as single source |
| Routing | **React Router v7** (data/SPA mode) | Nested routes `/index/:code`, tab children |
| Charts | **Apache ECharts 5** + `echarts-for-react` | Candlestick + `markArea` tier bands + `markPoint` lows in one API; strong CN ecosystem |
| Alt chart | TradingView **lightweight-charts** | Prefer only if pure candle perf matters; band fills need custom primitives |
| Theme | `data-theme="light\|dark"` on `<html>` | Matches token file; system preference + manual toggle |
| Fonts | Noto Sans SC (self-host or Google Fonts) + JetBrains Mono for tabular nums | CJK + aligned digits |

**Do not** invent a second token system — map Tailwind theme keys to `--qk-*` variables.

---

## 1. Design principles

1. **Trust over flash** — muted surfaces, restrained accent; no gradients on chrome, no decorative illustration.
2. **Data density with breathing room** — tight tables / panels, but 16–24px section gaps; never cram labels into chart.
3. **CN market conventions** — **红涨绿跌** (red = up, green = down). Tier severity deep→light: 85% darkest → 110% lightest.
4. **State is shareable** — index, period, range live in the URL so links reproduce the view.
5. **Color is never the only signal** — badges carry text (史诗底 / 重要底 / 未确认); markers differ by shape.
6. **Honesty about data** — always show 数据截至 timestamp; footer disclaimer; mockups mark 示例数据.
7. **Mobile = reflow, not shrink** — stack panels; sticky instrument switcher; tables → cards or horizontal scroll.
8. **Phase-2 ready IA** — nav slot + route tree leave room for 回测 / more instruments without redesign.

---

## 2. Information architecture & routes

### Nav (global header)

| Slot | Label | Route | Phase |
|------|-------|-------|-------|
| Brand | quki | `/` → redirect | 1 |
| Primary | 概览 | `/index/:code` (default tab) | 1 |
| Primary | 回测 | `/index/:code/backtest` | 2 (visible, may show “即将推出” empty) |
| Utility | 策略 | `/strategies` | 2 (nav slot reserved; hide or disable in phase 1) |
| Utility | Theme toggle | — | 1 |

Phase 1: show **概览** active; **回测** link present but page can be a stub. Hide **策略** or render as disabled with tooltip「即将推出」.

### Routes

```
/                              → redirect to /index/H30269?period=W&range=5Y
/index/:code                   → Overview (chart + position + lows)   [phase 1]
/index/:code/backtest          → Backtest results                     [phase 2]
/strategies                    → Strategy list (placeholder)          [phase 2]
```

### Valid `:code` (phase 1)

| code | Display name | Short |
|------|--------------|-------|
| `H30269` | 中证红利低波动指数 | 红利低波 |
| `000922` | 中证红利指数 | 中证红利 |

Unknown code → soft 404 empty state with link back to H30269.

### URL search params (overview)

| Param | Values | Default | Notes |
|-------|--------|---------|-------|
| `period` | `D` \| `W` | `W` | 日线 / 周线. MA55 is **always the 55-week MA**; on daily chart draw the weekly MA55 resampled onto daily axis (step or forward-fill). |
| `range` | `1Y` \| `3Y` \| `5Y` \| `10Y` \| `MAX` | `5Y` | Visible window; does not change underlying series fetch if already cached. |
| `vol` | `0` \| `1` | `0` | Volume pane optional. |
| `theme` | omit (prefer system / cookie) | — | Optional override; prefer localStorage + `data-theme`. |

Example: `/index/H30269?period=W&range=5Y&vol=0`

Tab state (概览 / 回测) is path-based, not a query param.

---

## 3. Page layout

### 3.1 Desktop (≥1280px)

```
┌─ Header 56px ──────────────────────────────────────────────────────────┐
│ [logo quki]   概览  回测          [theme]                               │
├─ Toolbar 48px (sticky under header) ───────────────────────────────────┤
│ [红利低波 H30269 | 中证红利 000922]   [日 周]   [1Y 3Y 5Y 10Y 全部]     │
│                                        数据截至 2026-10-31 15:00 北京时间 │
├─ Main (max-width 1440, padX 32, gap 24) ───────────────────────────────┤
│ ┌─ Chart card (flex 1) ──────────────┐ ┌─ Right rail 340px ──────────┐ │
│ │ Legend + chart 480 (+ vol 80)      │ │ PositionPanel               │ │
│ │                                    │ │ TierTable                   │ │
│ └────────────────────────────────────┘ └─────────────────────────────┘ │
│ ┌─ LowsTable (full width) ───────────────────────────────────────────┐ │
│ └────────────────────────────────────────────────────────────────────┘ │
├─ Footer ───────────────────────────────────────────────────────────────┤
│ 免责声明：本站数据与分析仅供参考，不构成投资建议。…                       │
└────────────────────────────────────────────────────────────────────────┘
```

- Content grid: `grid-template-columns: 1fr 340px; gap: 24px;`
- Chart card and right rail share top alignment; LowsTable spans both columns (`grid-column: 1 / -1`).
- Page background: `--qk-bg-canvas`; cards: `--qk-bg-surface`, border `--qk-border-default`, radius `--qk-radius-lg` (12px), shadow `--qk-shadow-sm`.

### 3.2 Tablet (481–1279px)

- Single column; right rail moves **below** chart.
- padX 20; chart height 400; sidebar becomes full-width stack of PositionPanel + TierTable (2-col grid if width ≥768).
- Toolbar may wrap: index switcher row 1; period+range row 2.

### 3.3 Mobile (≤480px)

```
[Header 52]
[Sticky toolbar: index pills — full width scroll] 
[period + range compact segmented controls]
[数据截至 …]
[PositionPanel]          ← stack order: position FIRST (decision context)
[Chart 280 + optional vol 48]
[TierTable as compact rows]
[Lows as cards]
[Footer]
```

- padX 16; section gap 16.
- Index switcher **sticky** below header (`position: sticky; top: 52px; z-index: 100`), horizontal scroll if needed, no wrap.
- LowsTable → **card list** (see §5.8); TierTable stays as compact table with horizontal scroll fallback if needed.
- Chart: touch pan/zoom enabled; crosshair follows touch.

---

## 4. Design tokens summary

Full values in `tokens.json` / `tokens.css`. Critical rules:

- **Surfaces:** canvas `#F4F6F8` / dark `#0B1220`; card white / `#111827`.
- **Brand primary:** navy `#1E3A5F` (light) — calm finance, not neon fintech.
- **Accent:** blue `#2563EB` for interactive focus / selected segment.
- **Market:** up `#DC2626`, down `#16A34A` (light); lighter variants in dark.
- **MA55 line:** purple `#7C3AED` / dark `#C4B5FD`, width **1.5px**, solid.
- **Tier fills:** opacity-graded bands (see chart section); strokes for axis labels.
- **Typography:** Noto Sans SC stack; **tabular numerals** for all prices / % / dates via `.qk-tabular` / `font-variant-numeric: tabular-nums`.
- **Radius:** controls 8px, cards 12px, pills full.
- **Breakpoints:** mobileMax 480, desktopMin 1280.

---

## 5. Component inventory

### 5.1 `AppHeader`

**Props**

```ts
type AppHeaderProps = {
  activeNav: 'overview' | 'backtest' | 'strategies';
  onNav: (id: 'overview' | 'backtest' | 'strategies') => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  showStrategies?: boolean; // default false in phase 1
};
```

**Layout:** height 56 (52 mobile). Logo wordmark「quki」16–18px semibold brand-primary + small subtitle「指数估值」10–11px tertiary (desktop only). Nav links: 14px medium; active = primary text + 2px accent underline inset. Theme toggle: icon button 36×36, aria-label「切换深色模式」/「切换浅色模式」.

**States:** default / hover (bg muted) / focus-visible (focus ring).

---

### 5.2 `IndexSwitcher`

**Props**

```ts
type IndexOption = { code: string; name: string; shortName: string };
type IndexSwitcherProps = {
  options: IndexOption[]; // phase1: H30269, 000922
  value: string;
  onChange: (code: string) => void;
  sticky?: boolean; // true on mobile
};
```

**UI:** segmented pill group. Selected: accent-muted bg + accent text + 1px accent border. Unselected: transparent, secondary text. Height 36px; padding 0 14px; radius full; gap 8. Show `shortName` + `code` on desktop (`红利低波 · H30269`); mobile show `shortName` only if space-constrained, code in smaller caps.

**A11y:** `role="tablist"` / `role="tab"` `aria-selected`; keyboard ←/→.

---

### 5.3 `PeriodToggle`

```ts
type PeriodToggleProps = {
  value: 'D' | 'W';
  onChange: (p: 'D' | 'W') => void;
};
```

Labels: **日** / **周**. Same segmented control pattern as range; size sm (height 32). Selected uses accent.

---

### 5.4 `RangeSelector`

```ts
type RangeSelectorProps = {
  value: '1Y' | '3Y' | '5Y' | '10Y' | 'MAX';
  onChange: (r: '1Y' | '3Y' | '5Y' | '10Y' | 'MAX') => void;
};
```

Labels: `1年` `3年` `5年` `10年` `全部`. Height 32; equal-width segments preferred on desktop.

---

### 5.5 `DataAsOf`

```ts
type DataAsOfProps = {
  asOf: string; // ISO datetime from API
  loading?: boolean;
};
```

Copy: `数据截至 {YYYY-MM-DD HH:mm} 北京时间`. Style: 12px tertiary; on loading show skeleton 120×14. Place top-right of toolbar on desktop; under toolbar on mobile.

---

### 5.6 `KlineChart`

```ts
type TierLevel = 85 | 90 | 95 | 100 | 105 | 110;

type Candle = {
  time: string; // YYYY-MM-DD (week ending Fri for W)
  open: number; high: number; low: number; close: number;
  volume?: number;
};

type SignificantLowMarker = {
  time: string;
  price: number;       // weekly low
  ratio: number;       // low / MA55
  confirmed: boolean;  // false → 未确认
  label?: string;      // e.g. 史诗底
};

type KlineChartProps = {
  period: 'D' | 'W';
  candles: Candle[];
  ma55: { time: string; value: number }[]; // aligned series
  tiers: Record<TierLevel, number>; // absolute index levels AT LATEST MA55 (for right-axis labels); bands follow MA55 historically
  markers: SignificantLowMarker[];
  showVolume?: boolean;
  height?: number; // default from tokens layout.chartHeight
  locale?: 'zh-CN';
  onCrosshair?: (point: null | { time: string; candle: Candle; ma55: number; ratio: number }) => void;
};
```

#### Chart styling (ECharts mapping)

| Element | Spec |
|---------|------|
| Candles up | fill `--qk-candle-up`, border `--qk-candle-border-up`, wick same |
| Candles down | fill `--qk-candle-down`, border `--qk-candle-border-down` |
| MA55 | line color `--qk-ma55`, width 1.5, no symbol |
| Grid | horizontal only, `--qk-chart-grid`, 1px |
| Axis | `--qk-chart-axis`, font 11px tabular |
| Crosshair | dashed `--qk-chart-crosshair` |
| Volume | optional child grid; up/down muted fills; height `--qk-volume-h` |

#### Tier bands

- For each historical point, band i is the region between `(tier_i / 100) * MA55` and `(tier_{i+1} / 100) * MA55`, plus outer fades.
- Practical ECharts approach: multiple `line` series for each tier% × MA55 (silent), with `areaStyle` between adjacent lines via `visualMap` or stacked custom series; or `markArea` on visible window refreshed on dataZoom.
- **Preferred:** compute six line series `ma55*0.85 … ma55*1.10`, draw with `areaStyle` on each upper series filling down to previous (opacity from tokens). Line stroke 1px dashed at each tier; **100% (MA55 itself)** may use slightly stronger dash.

| Tier | Meaning | Fill token | Right-axis label |
|------|---------|------------|------------------|
| 85% | 史诗底 | `--qk-tier-85-fill` | `85% 史诗底` + value |
| 90% | 重要底 | `--qk-tier-90-fill` | `90% 重要底` + value |
| 95% | — | `--qk-tier-95-fill` | `95%` + value |
| 100% | MA55 | `--qk-tier-100-fill` | `MA55` + value |
| 105% | — | `--qk-tier-105-fill` | `105%` + value |
| 110% | — | `--qk-tier-110-fill` | `110%` + value |

Right-axis labels: show **tier %** and **current absolute level** (2 decimals) for the **latest** MA55. Color = `--qk-tier-*-label`.

#### Markers (significant lows)

| State | Shape | Size | Fill | Stroke |
|-------|-------|------|------|--------|
| Confirmed | **Triangle down** (▼) below bar low | 10px | `--qk-marker-confirmed` | 1.5px `--qk-marker-stroke` |
| Unconfirmed | **Diamond** (◆) below bar low | 10px | `--qk-marker-unconfirmed` | 1.5px `--qk-marker-stroke` |

Also show small text tag on hover: `史诗底` / `重要底` / `未确认`. Do not rely on color alone — shape differs.

#### Legend (above chart, inside card)

Horizontal:  
`■ 上涨` `■ 下跌` `— MA55` `▓▓ 85%史诗底` … `▓▓ 110%` `▼ 已确认低点` `◆ 未确认低点`  
12px secondary; color swatches 10×10.

#### Crosshair tooltip contents

```
{YYYY-MM-DD} · 周线|日线
开 {o}  高 {h}  低 {l}  收 {c}     (2 decimals, up/down color on 收 vs prior)
MA55 {ma} ({ratio}%)               (ratio = close/MA55*100, 1 decimal)
距史诗底 {d85}%  距重要底 {d90}%    (optional compact)
成交量 {vol}                       (if vol on)
```

Tooltip panel: bg `--qk-chart-tooltip-bg`, border, radius 8, shadow md, 12px tabular nums. Follow CN finance tooltip density.

#### Empty / loading / error (chart)

- **Loading:** skeleton block same height as chart + shimmer; or ECharts `showLoading` with muted text「加载中…」.
- **Empty:** illustration-free; centered 14px secondary「暂无行情数据」+ retry button.
- **Error:**「行情加载失败」+ `重试` button (accent outline).

---

### 5.7 `PositionPanel`

```ts
type PositionPanelProps = {
  indexCode: string;
  indexName: string;
  asOf: string;
  lastClose: number;
  ma55: number;
  ratioPct: number;          // lastClose / ma55 * 100
  percentile: number;        // 0–100 historical percentile of ratio
  changePct?: number;        // vs previous session, optional
  status: 'loading' | 'ready' | 'error' | 'empty';
};
```

**Layout (card):**

1. Title row: `当前位置` + badge for band zone  
   - ratio &lt; 85 → badge 史诗底 (epic)  
   - &lt; 90 → 重要底 (important)  
   - &lt; 95 → 偏低 (neutral/orange-ish via important muted)  
   - &lt; 105 → 中性  
   - else → 偏高 / 远离均值 (neutral)
2. Hero metric: `{ratioPct}%` at 28–32px semibold tabular; sublabel `收盘 / MA55`.
3. Secondary row: `收盘 {lastClose}` · `MA55 {ma55}` (14px).
4. Percentile: progress meter 0–100 + label `历史分位 {n}%` — meaning: current ratio is higher than n% of historical weekly ratios. Helper text 12px tertiary:「分位越低表示相对越便宜」.
5. Optional day change with 红涨绿跌.

**States:** skeleton for loading; error inline with retry.

---

### 5.8 `TierTable`

```ts
type TierRow = {
  tier: TierLevel;
  label: string;       // 史诗底 / 重要底 / MA55 / …
  level: number;       // absolute index level
  distancePct: number; // (level - lastClose) / lastClose * 100  — positive = tier above price
};

type TierTableProps = {
  rows: TierRow[];
  lastClose: number;
  highlightTier?: TierLevel | null; // nearest / current band
};
```

**Columns:** 档位 | 含义 | 点位 | 距现价  

- 点位: 2 decimals tabular  
- 距现价: 1 decimal with sign, e.g. `-7.2%` (tier below) / `+12.4%`; color: if tier is a **buy zone below** (85/90/95) and distance negative (price above tier), use secondary; emphasize the next downside target in accent/warning. Keep simple: negative distance (price already above that floor) = tertiary; positive (price needs to fall to reach) = market-down green is **wrong semantically** — use neutral + bold for actionable downside targets instead. Spec rule: **do not paint distance with 涨跌色**; use primary/secondary only, bold the nearest tier below price.

**Mobile:** keep table; allow `overflow-x: auto` with min-width 320.

---

### 5.9 `LowsTable` / `LowsCards`

```ts
type LowRow = {
  weekEnd: string;     // YYYY-MM-DD
  weekLow: number;
  ma55: number;
  ratioPct: number;    // weekLow/ma55*100
  confirmed: boolean;
  tag: '史诗底' | '重要底' | '其他';
};

type LowsTableProps = {
  rows: LowRow[];      // sorted desc by weekEnd
  variant: 'table' | 'cards'; // cards ≤480
  status: 'loading' | 'ready' | 'error' | 'empty';
};
```

**Definition (product rule — implement exactly):**  
A significant low = a week whose `weekLow / MA55` is the **minimum within ±13 weeks** AND `ratio < 95%`.  
If fewer than 13 weeks have elapsed **after** that week, flag **未确认**.

**Table columns:** 周末日期 | 周低点 | 当日MA55 | 低点/MA55 | 标记  

- Latest unconfirmed row: left accent bar 3px warning + badge `未确认`.  
- Tag badges: 史诗底 / 重要底 per §tokens badge.  
- Empty:「暂无显著低点（需周低点/MA55 为 ±13 周最低且 &lt; 95%）」.

**Cards (mobile):** each card shows date + ratio hero + badges + 周低点/MA55 pair.

---

### 5.10 `DisclaimerFooter`

Fixed copy (zh-CN):

> **免责声明：** 本站展示的指数行情、均线与估值分位数据来源于公开信息整理，仅供学习与研究参考，**不构成投资建议**。市场有风险，决策需独立判断。数据可能存在延迟或遗漏，请以官方与交易通道披露为准。

Style: 12px tertiary; top border; padY 24; max-width same as content. Links (if any) use `--qk-text-link`.

---

### 5.11 Shared: `SegmentedControl`, `Badge`, `Skeleton`, `EmptyState`, `ErrorState`

- `SegmentedControl`: generic for period/range; props `options: {value,label}[]`, `value`, `onChange`, `size: 'sm'|'md'`.
- `Badge`: `variant: 'epic'|'important'|'unconfirmed'|'neutral'`.
- `Skeleton`: pulse opacity 0.4–1 on `--qk-bg-surface-muted` blocks.
- `EmptyState` / `ErrorState`: icon optional (simple geometric), title, description, primary action.

---

## 6. Number & date formatting

| Kind | Rule | Example |
|------|------|---------|
| Index level | 2 decimal places, tabular | `4856.32` |
| Percent / ratio | 1 decimal + `%` | `92.3%` |
| Distance % | 1 decimal, explicit `+`/`-` | `-4.6%` |
| Date | `YYYY-MM-DD` | `2026-10-31` |
| Datetime as-of | `YYYY-MM-DD HH:mm` + `北京时间` | `2026-10-31 15:00 北京时间` |
| Volume (CN) | compact 万/亿 | `1.23亿` |
| Percentile | integer 0–100 + `%` | `18%` |

Use `Intl.NumberFormat('zh-CN', …)` or equivalent; never locale that swaps decimal comma.

---

## 7. Chart behavior details

1. **MA55 always weekly:** When `period=D`, join weekly MA55 onto daily bars (forward-fill from week calculation). Legend still says `MA55（周）`.
2. **Default period W** — bands and lows are defined on weekly logic; daily is for finer price reading.
3. **DataZoom:** inside slider optional on desktop; pinch on mobile. Changing `range` sets start/end window.
4. **Performance:** for MAX daily, downsample candles outside pixel width if needed; keep MA55 full fidelity.
5. **Volume:** off by default (`vol=0`); toggle in chart card header checkbox「成交量」.

---

## 8. Accessibility

- Contrast: text primary on canvas/surface ≥ 4.5:1; secondary ≥ 4.5:1 against surface where used as body; tier label colors validated on white/dark surface (adjust if failing — prefer label token over fill).
- Focus: all controls `focus-visible` with `--qk-shadow-focus`.
- Chart: provide **data table fallback** in a disclosure `<details>`「查看数据表」for SR users (phase 1 nice-to-have; phase 1.1 required).
- Markers: shape + tooltip text, not color alone.
- `prefers-reduced-motion`: disable skeleton shimmer / chart animation.
- Hit targets ≥ 36px where possible (32px minimum for dense segments).

---

## 9. Responsive behavior checklist

| Item | Desktop | Tablet | Mobile |
|------|---------|--------|--------|
| Index switcher | inline toolbar | wrap | sticky + scroll |
| Chart height | 480 | 400 | 280 |
| Position panel | right rail | below chart | **above** chart |
| Tier table | right rail | below position | full width |
| Lows | table | table | **cards** |
| Toolbar | single row | two rows | stacked compact |

---

## 10. Phase 2 sketch — Backtest page (`/index/:code/backtest`)

Keep same Header + IndexSwitcher. Page body:

```
[Metric cards row ×4]
  年化收益 | 最大回撤 | 胜率 | 相对持有超额
[Equity chart card]
  Strategy equity vs Buy&Hold (two lines); drawdown subplot optional
[Trade table]
  入场日 | 出场日 | 持有周数 | 收益 | 触发规则（如 跌破90%MA55买入 …）
[Params panel / drawer]
  规则摘要（只读 phase 2.0）
```

Metric card: label 12px tertiary, value 22px semibold tabular, delta vs B&H in 红绿.  
Equity chart: strategy `--qk-brand-accent`, B&H `--qk-text-tertiary` dashed.  
Leave nav「策略」for multi-strategy comparison later.

---

## 11. Sample data contract (for mocks & tests)

Mocks **must** banner `示例数据` — never present as live.

Illustrative overview sample (H30269, weekly):

```
lastClose: 4856.32
ma55: 5120.00
ratioPct: 94.8
percentile: 22
tiers (absolute):
  85%: 4352.00   90%: 4608.00   95%: 4864.00
  100%: 5120.00  105%: 5376.00  110%: 5632.00
lows:
  2026-08-15  low 4580.00  ma55 5100  ratio 89.8%  重要底  未确认
  2024-02-02  low 4201.00  ma55 5050  ratio 83.2%  史诗底  已确认
  2022-10-28  low 4310.00  ma55 4980  ratio 86.5%  重要底  已确认
asOf: 2026-10-31T15:00:00+08:00
```

---

## 12. File deliverables in this folder

| Path | Purpose |
|------|---------|
| `SPEC.md` | This document |
| `tokens.json` | Machine-readable tokens |
| `tokens.css` | CSS variables for app import |
| `mockups/desktop-light.html` | Static desktop light mock |
| `mockups/desktop-dark.html` | Static desktop dark mock |
| `mockups/mobile.html` | Static mobile mock (390×844 frame) |
| `mockup-desktop-light.png` | Rendered |
| `mockup-desktop-dark.png` | Rendered |
| `mockup-mobile.png` | Rendered |

---

## 13. Implementation notes for the coding agent

1. Import `tokens.css` once at app root; drive Tailwind `@theme` from the same variables.
2. Prefer ECharts `candlestick` + line series for MA55/tiers; sync tooltip with `axisPointer`.
3. Keep presentational components dumb; URL is source of truth for `code/period/range/vol`.
4. Do not modify design files in `/workspace/quki-handoff/design/` from the app repo — copy tokens into the repo as needed.
5. All user-visible strings Simplified Chinese as specified.
