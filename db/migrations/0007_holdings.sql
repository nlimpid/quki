-- Account share counts and screenshot-import bookkeeping.
-- NOT APPLIED. Do not run this file from a worker, a cron, or an agent.
-- Apply only after 0006_auth.sql, with an explicit `pnpm migrate` once both are accepted.
-- Independent of 0005_dividend_audit.sql. This file does not read or alter dividend or index tables.
-- No foreign keys. The app scopes every statement by the session user id.
--
-- Rollback drops only these three tables. That deletes saved share counts and unused
-- import drafts. It does not change companies, dividend_events, or qk.holdings.v1.
-- There is no online dual-write, so a failed apply leaves 0006 in place and these tables absent.
-- auth_holdings.shares is an exact integer quantity, not a sum of screenshot passes.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS auth_holdings (
  user_id     CHAR(36)    NOT NULL,
  code        CHAR(6)     NOT NULL COMMENT '6-digit code, leading zeros preserved',
  shares      INT UNSIGNED NOT NULL COMMENT 'Total shares, 1 through 1000000000',
  updated_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-account share counts. No images and no local-browser import log.';

CREATE TABLE IF NOT EXISTS auth_import_drafts (
  id           CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  payload_json VARCHAR(8000) NOT NULL COMMENT 'Reviewed text fields only. Never the image or a data URL.',
  expires_at   DATETIME(3)  NOT NULL,
  consumed_at  DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_auth_import_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='One-time preview of untrusted image text. Consumed before a holdings write.';

CREATE TABLE IF NOT EXISTS auth_holding_applies (
  user_id          CHAR(36) NOT NULL,
  idempotency_key  CHAR(36) NOT NULL,
  payload_hash     CHAR(64) NOT NULL COMMENT 'SHA-256 of the confirmed code and share list',
  created_at       DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Stops a repeated apply from writing a second time. Same key is isolated per user.';
