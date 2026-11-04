-- =============================================================================
-- quki.cc database schema
-- Target: TiDB Serverless Starter (MySQL-compatible)
-- Access: Cloudflare Workers via @tidbcloud/serverless (HTTP driver)
-- Charset: utf8mb4 throughout
--
-- Design notes (also see DESIGN.md):
--   * No FOREIGN KEY constraints (TiDB supports FKs but avoid for serverless/
--     write throughput; enforce in app). No triggers / procedures / events.
--   * Series tables use CLUSTERED composite natural PKs (instrument_id, freq,
--     trade_date) — good for range scans and UPSERT idempotency.
--   * Surrogate keys use BIGINT AUTO_RANDOM to avoid AUTO_INCREMENT hotspots
--     on TiDB (requires CLUSTERED PK; default on TiDB for single-column PK).
--   * Prices/amounts: DECIMAL for money-like OHLCV that must round cleanly;
--     DOUBLE OK for derived ratios (deviation, percentile) where IEEE float
--     is fine and slightly cheaper.
--   * Upserts: INSERT ... ON DUPLICATE KEY UPDATE (TiDB supports both
--     VALUES(col) legacy and row-alias AS new forms).
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- instruments: indices, ETFs, stocks across exchanges/sources
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instruments (
  id            BIGINT UNSIGNED NOT NULL AUTO_RANDOM COMMENT 'Surrogate PK; AUTO_RANDOM avoids TiDB write hotspot',
  symbol        VARCHAR(32)  NOT NULL COMMENT 'Exchange/source symbol, e.g. 000922, H30269, 510880',
  name          VARCHAR(128) NOT NULL COMMENT 'Display name, e.g. 中证红利',
  name_en       VARCHAR(128) NULL COMMENT 'Optional English name',
  asset_type    ENUM('index','etf','stock','other') NOT NULL DEFAULT 'index',
  exchange      VARCHAR(32)  NULL COMMENT 'SSE/SZSE/CSI/HKEX/etc.; CSI for CSIndex codes',
  currency      CHAR(3)      NOT NULL DEFAULT 'CNY',
  is_total_return TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = 全收益 / total-return series',
  related_id    BIGINT UNSIGNED NULL COMMENT 'App-level link: price index <-> total-return twin (no FK)',
  source        VARCHAR(32)  NOT NULL DEFAULT 'csindex' COMMENT 'Primary data source key: csindex, sina, eastmoney, ...',
  source_code   VARCHAR(64)  NULL COMMENT 'Source-specific code if different from symbol',
  meta          JSON         NULL COMMENT 'Extensible: base_date, publisher, listing_date, tags, ...',
  status        ENUM('active','delisted','paused') NOT NULL DEFAULT 'active',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id) CLUSTERED,
  UNIQUE KEY uk_instruments_source_symbol (source, symbol),
  KEY idx_instruments_type_status (asset_type, status),
  KEY idx_instruments_related (related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tradable / indexable instruments; extend freely for ETF/stock';

-- -----------------------------------------------------------------------------
-- bars: OHLCV (+ amount) at day-or-longer frequencies
-- Composite clustered PK enables range scans by instrument+freq+date and
-- natural idempotent upserts on (instrument_id, freq, trade_date).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bars (
  instrument_id BIGINT UNSIGNED NOT NULL,
  freq          ENUM('D','W','M','Q','Y') NOT NULL COMMENT 'D=daily, W=weekly, M=monthly, Q=quarterly, Y=yearly',
  trade_date    DATE         NOT NULL COMMENT 'Bar date: daily = session date; weekly = week-ending trade date (convention documented in crawler)',
  open          DECIMAL(18,6) NOT NULL,
  high          DECIMAL(18,6) NOT NULL,
  low           DECIMAL(18,6) NOT NULL,
  close         DECIMAL(18,6) NOT NULL,
  volume        DECIMAL(24,4) NULL COMMENT 'Share/contract volume; NULL if source omits',
  amount        DECIMAL(24,4) NULL COMMENT 'Turnover amount in currency units; NULL if source omits',
  pre_close     DECIMAL(18,6) NULL COMMENT 'Previous close when source provides it',
  change_pct    DECIMAL(12,6) NULL COMMENT 'Percent change vs prior close if provided',
  source        VARCHAR(32)  NOT NULL DEFAULT 'csindex',
  crawled_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id, freq, trade_date) CLUSTERED,
  KEY idx_bars_freq_date (freq, trade_date),
  KEY idx_bars_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OHLCV bars; DECIMAL for prices/amounts to avoid float drift on money-like values';

-- -----------------------------------------------------------------------------
-- analytics_series: versioned derived metrics (MA55, deviation, percentile, ...)
-- Recomputable by (metric, params_hash). Upsert on natural key.
-- metric_value as DOUBLE: ratios/percentiles don't need banker's rounding.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_series (
  instrument_id BIGINT UNSIGNED NOT NULL,
  freq          ENUM('D','W','M','Q','Y') NOT NULL,
  trade_date    DATE         NOT NULL,
  metric        VARCHAR(64)  NOT NULL COMMENT 'e.g. ma55, close_ma55_dev, close_ma55_dev_pctile, significant_low',
  params_hash   CHAR(16)     NOT NULL COMMENT 'Short hash of params JSON (e.g. first 16 hex of sha256) for versioning',
  params        JSON         NOT NULL COMMENT 'Full params snapshot, e.g. {"window":55,"lookback":260,"low_threshold":0.05}',
  metric_value  DOUBLE       NULL COMMENT 'Primary numeric value; NULL for flag-like metrics stored in extra',
  extra         JSON         NULL COMMENT 'Secondary fields: is_low, rank, count, notes, ...',
  computed_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id, freq, trade_date, metric, params_hash) CLUSTERED,
  KEY idx_analytics_metric_date (instrument_id, metric, params_hash, trade_date),
  KEY idx_analytics_computed (computed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Derived analytics versioned by metric+params_hash; recomputable and upsertable';

-- -----------------------------------------------------------------------------
-- significant_lows: optional convenience projection of analytics_series
-- (metric='significant_low'). Kept as its own table for chart/query locality;
-- can be rebuilt from analytics_series. Same versioning via params_hash.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS significant_lows (
  instrument_id BIGINT UNSIGNED NOT NULL,
  freq          ENUM('D','W','M','Q','Y') NOT NULL,
  trade_date    DATE         NOT NULL,
  params_hash   CHAR(16)     NOT NULL,
  params        JSON         NOT NULL,
  low_price     DECIMAL(18,6) NOT NULL,
  close_price   DECIMAL(18,6) NULL,
  deviation     DOUBLE       NULL COMMENT 'close/MA or other deviation at the low',
  score         DOUBLE       NULL COMMENT 'Optional significance score',
  extra         JSON         NULL,
  computed_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id, freq, trade_date, params_hash) CLUSTERED,
  KEY idx_siglows_date (instrument_id, freq, trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Significant lows projection; rebuildable from analytics_series';

-- -----------------------------------------------------------------------------
-- backtest_runs: strategy executions with params + summary metrics
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_RANDOM,
  name            VARCHAR(128) NOT NULL COMMENT 'Human label for the run',
  strategy        VARCHAR(64)  NOT NULL COMMENT 'Strategy key, e.g. ma55_dev_percentile',
  params          JSON         NOT NULL COMMENT 'Strategy params JSON',
  instrument_ids  JSON         NOT NULL COMMENT 'Array of instrument ids used',
  freq            ENUM('D','W','M','Q','Y') NOT NULL DEFAULT 'W',
  start_date      DATE         NOT NULL,
  end_date        DATE         NOT NULL,
  initial_capital DECIMAL(18,2) NOT NULL DEFAULT 1000000.00,
  -- Summary metrics (nullable until run finishes)
  annualized_return DOUBLE     NULL COMMENT 'CAGR-like annualized return (fraction, e.g. 0.12)',
  max_drawdown      DOUBLE     NULL COMMENT 'Max drawdown as negative fraction, e.g. -0.25',
  win_rate          DOUBLE     NULL COMMENT 'Winning trades / total trades',
  avg_holding_weeks DOUBLE     NULL,
  total_trades      INT        NULL,
  sharpe            DOUBLE     NULL,
  calmar            DOUBLE     NULL,
  metrics           JSON       NULL COMMENT 'Full metrics bag for extensibility',
  status            ENUM('pending','running','done','failed') NOT NULL DEFAULT 'pending',
  error_message     TEXT       NULL,
  started_at        DATETIME(3) NULL,
  finished_at       DATETIME(3) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id) CLUSTERED,
  KEY idx_backtest_strategy_status (strategy, status),
  KEY idx_backtest_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Backtest run headers + summary metrics';

-- -----------------------------------------------------------------------------
-- backtest_trades: individual fills / round-trips for a run
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_trades (
  id            BIGINT UNSIGNED NOT NULL AUTO_RANDOM,
  run_id        BIGINT UNSIGNED NOT NULL COMMENT 'backtest_runs.id (app-enforced)',
  instrument_id BIGINT UNSIGNED NOT NULL,
  side          ENUM('buy','sell') NOT NULL,
  trade_date    DATE         NOT NULL,
  price         DECIMAL(18,6) NOT NULL,
  quantity      DECIMAL(18,6) NOT NULL COMMENT 'Shares/units; use fractional for index units if needed',
  amount        DECIMAL(18,2) NOT NULL COMMENT 'price * quantity (signed or always positive + side)',
  fee           DECIMAL(18,4) NOT NULL DEFAULT 0,
  pnl           DECIMAL(18,2) NULL COMMENT 'Realized PnL on exit legs',
  holding_weeks DOUBLE       NULL,
  extra         JSON         NULL COMMENT 'Signal reason, MA/percentile at entry, etc.',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id) CLUSTERED,
  KEY idx_bt_trades_run_date (run_id, trade_date),
  KEY idx_bt_trades_instrument (run_id, instrument_id, trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Backtest trade legs';

-- -----------------------------------------------------------------------------
-- backtest_equity: equity curve points (one row per date per run)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_equity (
  run_id        BIGINT UNSIGNED NOT NULL,
  trade_date    DATE         NOT NULL,
  equity        DECIMAL(18,2) NOT NULL,
  cash          DECIMAL(18,2) NULL,
  drawdown      DOUBLE       NULL COMMENT 'Drawdown fraction vs peak at this date',
  position_value DECIMAL(18,2) NULL,
  extra         JSON         NULL,
  PRIMARY KEY (run_id, trade_date) CLUSTERED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Backtest equity curve; clustered by (run_id, trade_date)';

-- -----------------------------------------------------------------------------
-- crawl_runs: cron / job log + watermark/cursor for resumable crawls
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crawl_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_RANDOM,
  job_name        VARCHAR(64)  NOT NULL COMMENT 'e.g. crawl_bars_daily, compute_ma55',
  source          VARCHAR(32)  NOT NULL COMMENT 'csindex, sina, ...',
  instrument_id   BIGINT UNSIGNED NULL COMMENT 'NULL = multi-instrument / job-level',
  freq            ENUM('D','W','M','Q','Y') NULL,
  status          ENUM('running','success','partial','failed') NOT NULL DEFAULT 'running',
  rows_upserted   INT          NOT NULL DEFAULT 0,
  cursor_watermark VARCHAR(128) NULL COMMENT 'Opaque resume token or last trade_date ISO string',
  request_meta    JSON         NULL COMMENT 'URL, params, page, batch id',
  error_message   TEXT         NULL,
  started_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at     DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id) CLUSTERED,
  KEY idx_crawl_job_started (job_name, started_at),
  KEY idx_crawl_instrument_job (instrument_id, job_name, started_at),
  KEY idx_crawl_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Crawl/compute job log with watermark for cron Workers';

-- -----------------------------------------------------------------------------
-- crawl_watermarks: latest successful watermark per job scope (fast lookup)
-- Separate from crawl_runs so cron can SELECT one row without scanning history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crawl_watermarks (
  job_name        VARCHAR(64)  NOT NULL,
  source          VARCHAR(32)  NOT NULL,
  instrument_id   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = job-level (all instruments)',
  freq            ENUM('D','W','M','Q','Y','*') NOT NULL DEFAULT '*' COMMENT '* = not freq-specific',
  watermark       VARCHAR(128) NOT NULL COMMENT 'Last successful cursor / trade_date',
  last_run_id     BIGINT UNSIGNED NULL,
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (job_name, source, instrument_id, freq) CLUSTERED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Latest watermarks for idempotent/resumable crawls';

-- =============================================================================
-- Seed: four initial CSIndex instruments
-- Verified 2026-11 via CSIndex factsheets:
--   中证红利 000922  <-> 全收益 H00922
--   红利低波 H30269  <-> 全收益 H20269
-- related_id left NULL on insert; linked in a follow-up UPDATE by symbol pair.
-- AUTO_RANDOM means we cannot hardcode ids; use symbol joins for related_id.
-- =============================================================================

INSERT INTO instruments (symbol, name, name_en, asset_type, exchange, currency, is_total_return, source, source_code, meta, status)
VALUES
  ('000922', '中证红利', 'CSI Dividend Index', 'index', 'CSI', 'CNY', 0, 'csindex', '000922',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'base_value', 1000, 'twin_symbol', 'H00922'), 'active'),
  ('H00922', '中证红利全收益', 'CSI Dividend Total Return Index', 'index', 'CSI', 'CNY', 1, 'csindex', 'H00922',
   JSON_OBJECT('publisher', 'CSI', 'twin_symbol', '000922'), 'active'),
  ('H30269', '红利低波', 'CSI Dividend Low Volatility Index', 'index', 'CSI', 'CNY', 0, 'csindex', 'H30269',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2005-12-30', 'base_value', 1000, 'twin_symbol', 'H20269'), 'active'),
  ('H20269', '红利低波全收益', 'CSI Dividend Low Volatility Total Return Index', 'index', 'CSI', 'CNY', 1, 'csindex', 'H20269',
   JSON_OBJECT('publisher', 'CSI', 'twin_symbol', 'H30269'), 'active')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  name_en = VALUES(name_en),
  asset_type = VALUES(asset_type),
  exchange = VALUES(exchange),
  is_total_return = VALUES(is_total_return),
  source_code = VALUES(source_code),
  meta = VALUES(meta),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

-- Wire price <-> total-return twins (app-level related_id; no FK)
UPDATE instruments i
JOIN instruments t
  ON t.source = i.source
 AND t.symbol = JSON_UNQUOTE(JSON_EXTRACT(i.meta, '$.twin_symbol'))
SET i.related_id = t.id
WHERE i.source = 'csindex'
  AND i.symbol IN ('000922', 'H00922', 'H30269', 'H20269');
