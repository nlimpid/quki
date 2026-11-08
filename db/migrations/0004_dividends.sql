-- A-share companies and implemented cash / bonus / transfer events.
-- Universe written by ingest: Shanghai + Shenzhen, listed only.
-- Beijing (BJ) rows are not inserted. Delisted names stay with listing_status
-- = 'delisted' and are hidden from the product list.
-- Upserts use INSERT ... ON DUPLICATE KEY UPDATE ... VALUES(col).
-- TiDB Serverless rejects the row-alias form (AS new).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS companies (
  code            CHAR(6)      NOT NULL COMMENT '6-digit A-share code, zero-padded',
  secucode        VARCHAR(16)  NOT NULL COMMENT '600519.SH / 000001.SZ; join key to dividend_events',
  name            VARCHAR(64)  NOT NULL COMMENT 'Latest short name',
  market          ENUM('SH','SZ','BJ') NOT NULL COMMENT 'BJ is allowed by the column but ingest does not write it',
  exchange_board  ENUM('main','cyb','kcb','bj') NULL COMMENT 'main / ChiNext / STAR; bj unused',
  listing_status  ENUM('listed','delisted','unknown') NOT NULL DEFAULT 'listed',
  list_date       DATE         NULL,
  sina_symbol     VARCHAR(16)  NULL COMMENT 'Raw Sina symbol, e.g. sh600519',
  last_close      DECIMAL(18,4) NULL COMMENT 'Last known trade from Sina hs_a; not a live quote',
  last_close_at   DATETIME(3)  NULL COMMENT 'When last_close was last observed',
  quote_fresh     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = this crawl had a positive trade; 0 = show last_close grayed',
  list_seen_gen   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Generation of the last full hs_a crawl that saw this code',
  ttm_cash_per_share DECIMAL(18,8) NULL COMMENT 'Trailing 12 calendar months pretax cash per current share, split-adjusted',
  trailing_yield_pct DOUBLE    NULL COMMENT 'ttm_cash_per_share / last_close * 100; NULL when price is missing',
  last_ex_dividend_date DATE   NULL COMMENT 'Latest implemented cash ex-dividend date',
  last_cash_per_10 DECIMAL(18,6) NULL COMMENT 'Pretax cash per 10 shares on that ex-date',
  yield_as_of     DATE         NULL COMMENT 'Shanghai date the trailing window was closed on',
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code) CLUSTERED,
  UNIQUE KEY uk_companies_secucode (secucode),
  KEY idx_companies_listed_market (listing_status, market, code),
  KEY idx_companies_yield (listing_status, trailing_yield_pct),
  KEY idx_companies_ex (listing_status, last_ex_dividend_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Listed Shanghai and Shenzhen A-shares. No ETFs. BJ is not ingested.';

CREATE TABLE IF NOT EXISTS dividend_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_RANDOM,
  event_key       CHAR(64)     NOT NULL COMMENT 'SHA-256 of secucode, report/plan/notice dates, profile, ex-date',
  secucode        VARCHAR(16)  NOT NULL,
  code            CHAR(6)      NOT NULL,
  name            VARCHAR(64)  NULL,
  report_date     DATE         NULL COMMENT 'Eastmoney REPORT_DATE fiscal period end',
  plan_notice_date DATE        NULL COMMENT 'PLAN_NOTICE_DATE',
  notice_date     DATE         NULL COMMENT 'NOTICE_DATE, usually the implementation notice',
  equity_record_date DATE      NULL COMMENT '股权登记日',
  ex_dividend_date DATE        NULL COMMENT '除权除息日; product history requires this',
  pay_cash_date   DATE         NULL COMMENT 'Reserved. RPT_SHAREBONUS_DET does not provide it',
  assign_progress VARCHAR(64)  NOT NULL COMMENT 'Raw ASSIGN_PROGRESS. Ingest keeps 实施分配 only',
  impl_plan_profile VARCHAR(1024) NOT NULL COMMENT 'Raw IMPL_PLAN_PROFILE',
  cash_div_pretax_per_10 DECIMAL(18,6) NULL COMMENT 'PRETAX_BONUS_RMB, yuan per 10 shares, pretax',
  cash_div_aftertax_per_10 DECIMAL(18,6) NULL COMMENT 'Parsed from 扣税后X元 when the profile has it',
  cash_div_pretax_per_share DECIMAL(18,8) NULL COMMENT 'cash_div_pretax_per_10 / 10, before split adjustment',
  bonus_ratio_per_10 DECIMAL(18,6) NULL COMMENT 'BONUS_RATIO, bonus shares per 10 shares',
  transfer_ratio_per_10 DECIMAL(18,6) NULL COMMENT 'IT_RATIO, transfer shares per 10 shares',
  bonus_transfer_sum_per_10 DECIMAL(18,6) NULL COMMENT 'BONUS_IT_RATIO when Eastmoney sends it',
  currency        CHAR(3)      NOT NULL DEFAULT 'CNY',
  market_type_em  VARCHAR(32)  NULL,
  is_implemented  TINYINT(1)   NOT NULL COMMENT '1 = 实施分配 and ex_dividend_date is present',
  source          VARCHAR(64)  NOT NULL COMMENT 'eastmoney:RPT_SHAREBONUS_DET',
  fetched_at      DATETIME(3)  NOT NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id) CLUSTERED,
  UNIQUE KEY uk_dividend_event_key (event_key),
  KEY idx_dividend_code_ex (code, ex_dividend_date),
  KEY idx_dividend_ex (ex_dividend_date, is_implemented)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Implemented cash dividends and bonus/transfer rows. Plans are not stored.';
