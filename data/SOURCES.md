# CSI index OHLCV sources (quki.cc crawler notes)

Tested 2026-11-04 from a **Cloudflare egress IP** (San Jose, US — `AS13335`, e.g. `104.28.233.76`). That is a fair proxy for Cloudflare Worker `fetch` (Workers also egress from Cloudflare IPs, usually outside China).

## Verified index codes (csindex.com.cn factsheets)

| Index | Price | Total return (全收益) |
| --- | --- | --- |
| 红利低波 / CSI Dividend Low Volatility | **H30269** | **H20269** (confirmed; Reuters `.CSIH20269`) |
| 中证红利 / CSI Dividend | **000922** | **H00922** (confirmed; Reuters `.CSIH00922`) |

Base dates: H30269/H20269 = 2005-12-30 (基点 1000); 000922/H00922 = 2004-12-31 (基点 1000).

## Units (CSIndex `index-perf` — used in the CSVs)

- **volume** (`tradingVol`): **股** (shares). Matches OSS Excel column `成交量（股）` 1:1.
- **amount** (`tradingValue`): **亿元** CNY. Excel `成交金额（元）` ≈ API × 1e8 (e.g. 2021-08-27: API `189.99` vs Excel `18,999,124,052` 元).
- Total-return series often have **empty open/high/low** (close only). Volume/amount on TR codes are usually copied from the price index when present.

---

## Endpoints tried

### 1) CSIndex official `index-perf` — **RECOMMENDED**

```
GET https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode={CODE}&startDate=YYYYMMDD&endDate=YYYYMMDD
```

| | |
| --- | --- |
| Works? | **Yes** — HTTP 200 JSON from Cloudflare US IP |
| History | Full from base date in **one request** (H30269 ≈ 5061 rows; 000922 ≈ 5303). No pagination needed for these series. |
| Fields | `tradeDate`, OHLCV-like: `open,high,low,close`, `tradingVol`, `tradingValue`, plus `change,changePct,consNumber,peg`, names |
| Headers | **None required.** Works with bare `fetch` / curl and with `User-Agent: Cloudflare-Workers`. Optional: `Referer: https://www.csindex.com.cn/`, browser UA. |
| Date-range limits | Multi-year / full-history OK (~2 MB). **Caveat:** if `startDate` is a non-trading day or before first real bar, API may emit a **phantom row** dated as `startDate` that clones the next real bar (seen for `20040101` and `20260101`). Prefer official base date as `startDate`, or drop rows before base / zero-vol clones. |
| Rate / anti-bot | 5 quick sequential calls: all 200, ~0.7–1.5s. No Cloudflare challenge, no cookie wall, no 403 observed. Still be polite (e.g. ≥1s between codes). |
| Worker suitability | **Excellent.** Plain `fetch`, no browser, works from CF IPs outside China. |

**Sample request:**

```bash
curl -sS 'https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=H30269&startDate=20260625&endDate=20260630'
```

**Trimmed sample response:**

```json
{
  "code": "200",
  "msg": "Success",
  "success": true,
  "data": [
    {
      "tradeDate": "20260629",
      "indexCode": "H30269",
      "indexNameCn": "红利低波",
      "open": 10134.83,
      "high": 10231.18,
      "low": 9954.7,
      "close": 10204.61,
      "tradingVol": 4096409638.0,
      "tradingValue": 450.14,
      "consNumber": 50.0
    }
  ]
}
```

akshare wraps the same URL as `stock_zh_index_hist_csindex`.

---

### 2) CSIndex OSS Excel autofile — partial

```
GET https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/perf/{CODE}perf.xls
```

| | |
| --- | --- |
| Works? | **H30269 / 000922: Yes** (OLE `.xls`, ~25 recent rows). **H20269 / H00922: 404** (JPEG error body). |
| History | ~1 month rolling snapshot only — **not** full history. |
| Fields | Date, OHLC, change, volume(股), turnover(**元**), cons count. |
| Headers | None special. |
| Worker? | Fine for a small recent check; useless as primary history source. |
| Note | `www.csindex.com.cn/uploads/file/autofile/perf/...` returns SPA HTML, not the file — use the `oss-ch.csindex.com.cn` host. |

---

### 3) Eastmoney `push2his` kline — **fails from CF IP**

```
GET https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={mkt}.{code}&klt=101&fqt=0&beg=...&end=...&fields1=...&fields2=...
```

akshare: `stock_zh_index_daily_em` / `index_zh_a_hist` (CSI often `secid=2.{code}`).

| | |
| --- | --- |
| Works from this box? | **No** — TLS `unexpected eof` / empty response on `push2his.eastmoney.com` and numbered mirrors; occasional 502 on `push2delay`. |
| Likely cause | Geo / IP reputation toward Cloudflare / non-China egress (not tested from a China residential IP). |
| Worker? | **Do not rely on this** for production Workers. |

---

### 4) Tencent / QQ finance — OK for SSE-style codes only

Realtime: `https://qt.gtimg.cn/q=sh000922` — works.  
History (akshare `stock_zh_index_daily_tx`):

```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?_var=kline_dayqfq&param=sh000922,day,YYYY-01-01,YYYY-12-31,640,qfq
```

| | |
| --- | --- |
| Works? | **000922 (`sh000922`): Yes.** Closes matched CSIndex exactly on 2026-06 overlap. |
| H30269 / H* TR | No usable symbol (`qtH30269` → none match). |
| Volume units | Tencent volume ≈ CSIndex / **100** → **手** (lots); CSIndex is 股. |
| Limits | Year-chunked; needs many requests for full history. |
| Worker? | Usable fallback for `000922` only; not for H-codes. |

---

### 5) Sina — limited / incomplete for these indices

- Realtime `https://hq.sinajs.cn/list=sh000922` — returns zeros / empty for these.
- Day K: `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh000922&scale=240&ma=no&datalen=1023` — works but **capped** (~1023 bars) and did not reach 2026 in this test window.
- Encrypted hist (akshare `stock_zh_index_daily`): `https://finance.sina.com.cn/realstock/company/{symbol}/hisdata/klc_kl.js` — JS-decoded; H30269 symbols (`csiH30269` etc.) returned null.
- Worker? Weak primary; IP bans reported by akshare docs under heavy use.

---

### 6) Other CSIndex JSON paths tried

`index-performance`, `index-perf-export`, `indexInfo/index-basic-info`, `index/weight/download` → **404**.

---

## Data anomalies (kept as source-faithful)

- **H30269** missing OHLC for most sessions **2016-06-14 → ~2018-06** (2017: all 244 days close-only). Close/volume/amount still present.
- **2018-06-18** on all four codes: close equals prior day, **volume=0, amount=0**, empty OHLC — likely a bad/holiday publish; left in place.
- **H20269 / H00922**: open/high/low always empty in API; close populated from base date.
- **H00922**: volume/amount often 0 in early years (~1165 zero-vol rows), then filled (usually mirroring 000922).
- Do not use `startDate` before base / on holidays without filtering phantom clone rows.

## Cross-checks

- H30269 **2026-06-29 close = 10204.61** (matches requested weekly sanity ~10204.61).
- 000922 June 2026 closes: CSIndex vs Tencent **exact match** (max abs diff 0).
- TR vs price long-run: H20269 ≫ H30269 and H00922 ≫ 000922 multiples — directionally consistent with dividend reinvestment.

---

## Production Worker recommendation

1. **Primary:** CSIndex `index-perf` with `startDate` = official base date (or last stored date − few days for incremental), `endDate` = today (`YYYYMMDD`).
2. Parse `data[]`; map `tradeDate` → `YYYY-MM-DD`; write `date,open,high,low,close,volume,amount`; leave nulls as empty; treat `tradingValue` as **亿元**, `tradingVol` as **股**.
3. No special headers/cookies. One request per index per run is enough for full backfill; for cron, prefer incremental windows.
4. Skip Eastmoney from Workers. Optional: Tencent as close-only cross-check for `000922`.
5. Sleep ≥1s between index calls; retry 5xx with backoff. Monitor for new WAF (none seen 2026-11-04).


---

## Addendum: 中证A股 (930903) & 中证全指 (000985)

Fetched 2026-11-04 via the same `index-perf` endpoint. Units unchanged (volume=股, amount=亿元).

### Codes verified

| Index | Price | Total return (全收益) | How verified |
| --- | --- | --- | --- |
| 中证A股 / CSI China A Share | **930903** | **H20903** (Reuters `.CSIH20903`; also net-return **N20903**) | Official factsheet PDF `930903factsheet.pdf` on `oss-ch.csindex.com.cn` — “衍生指数 / 全收益指数 代码 H20903”. API returns `indexNameCn=中证A股全收益`. |
| 中证全指 / CSI All Share | **000985** | **H00985** (Reuters `.CSIH00985`; also net-return **N00985**) | Official factsheet PDF `000985factsheet.pdf` — “全收益指数 代码 H00985”. API returns `indexNameCn=中证全指全收益`. |

Base dates (factsheet): **930903 / H20903 = 1999-12-31** (基值 1000); **000985 / H00985 = 2004-12-31** (基值 1000).  
Note: 930903 *methodology* PDF says 基日 **1999-12-30**; factsheet + `index-perf` use **1999-12-31**. No `19991230` row in the API. Used factsheet/API date as `startDate`.

Publish dates (factsheet): 930903 = 2016-10-18; 000985 = 2011-08-02. API still returns backfilled history before publish (same as other CSI series).

### Coverage written to CSV

| File | Rows | Range | Notes |
| --- | --- | --- | --- |
| `930903.csv` | 5304 | 1999-12-31 → 2026-11-04 | Price; full OHLC almost throughout |
| `H20903.csv` | 5304 | 1999-12-31 → 2026-11-04 | TR; open/high/low always empty |
| `000985.csv` | 5303 | 2004-12-31 → 2026-11-03 | Price; base close=1000 |
| `H00985.csv` | 5303 | 2004-12-31 → 2026-11-03 | TR; OHLC empty; early volume often 0 |

### Quirks / gaps

1. **930903 / H20903 early hole:** only one pre-2005 bar (`1999-12-31`), then jumps to `2005-01-04` (1831 calendar days). That first bar’s OHLCV is an **exact clone of 2005-01-04** (same phantom-clone pattern as holiday `startDate`s). Continuous daily history effectively starts **2005-01-04**. First close is **705.24** (price) / **724.71** (TR), **not** the stated 基值 1000 — treat 1999-12-31 as a labeled anchor/clone, not a true 1000-point base print in this API.
2. **As-of lag mismatch:** on 2026-11-04 Asia/Shanghai, 930903/H20903 already include **2026-11-04**; 000985/H00985 stop at **2026-11-03**. Cron should tolerate per-index last dates.
3. **2018-06-18** zero-vol / empty-OHLC anomaly appears on these series too (same family of CSI publish glitch as H30269/000922).
4. **H00985** volume/amount stay 0 until ~2018-06-18 region (~1601 zero-vol rows), then usually mirror 000985 — same pattern as H00922.
5. TR vs price from 2005-01-04 → latest: multiples ~5.0× price vs ~6.8–6.9× TR — directionally consistent with 中证A股全收益 outperforming the price index (matches user chart intent to prefer H20903).

### Worker note

Same recommendation as above: one `index-perf` call per code from official factsheet base date (or last stored date for incremental). Prefer **H20903** when the product needs 中证A股全收益.
