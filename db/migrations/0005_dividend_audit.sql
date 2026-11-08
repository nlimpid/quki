-- Audit columns for cninfo-over-eastmoney source priority.
-- NOT APPLIED to production by the change that added this file.
-- Cron does not run migrations. Apply only with an explicit migrate after review.
-- The daily Eastmoney upsert does not write these columns, so ingest keeps
-- working on the pre-0005 schema. After this migration, writeDividendSourceAudit
-- can store both sources. It refuses a database named quki.

ALTER TABLE dividend_events
  ADD COLUMN cash_source VARCHAR(32) NULL COMMENT 'eastmoney or cninfo after source priority',
  ADD COLUMN ex_dividend_date_source VARCHAR(32) NULL COMMENT 'Which source supplied ex_dividend_date',
  ADD COLUMN pay_cash_date_source VARCHAR(32) NULL COMMENT 'Which source supplied pay_cash_date',
  ADD COLUMN cash_div_pretax_per_10_em DECIMAL(18,6) NULL COMMENT 'Eastmoney pretax cash per 10 before override',
  ADD COLUMN cash_div_pretax_per_10_cninfo DECIMAL(18,6) NULL COMMENT 'Cninfo pretax cash per 10',
  ADD COLUMN ex_dividend_date_em DATE NULL COMMENT 'Eastmoney ex-dividend date',
  ADD COLUMN ex_dividend_date_cninfo DATE NULL COMMENT 'Cninfo ex-dividend date',
  ADD COLUMN pay_cash_date_em DATE NULL COMMENT 'Eastmoney pay date, usually null on RPT_SHAREBONUS_DET',
  ADD COLUMN pay_cash_date_cninfo DATE NULL COMMENT 'Cninfo 派息日',
  ADD COLUMN impl_plan_profile_em VARCHAR(1024) NULL COMMENT 'Eastmoney plan text kept beside any override',
  ADD COLUMN impl_plan_profile_cninfo VARCHAR(1024) NULL COMMENT 'Cninfo plan text kept beside any override',
  ADD COLUMN source_overridden TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 when cninfo replaced eastmoney cash, ex, or pay';
