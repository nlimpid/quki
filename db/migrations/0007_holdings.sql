-- One account book per user. NOT APPLIED. Do not run this from a worker, cron, or agent.
-- Apply only after 0006_auth.sql, with an explicit `pnpm migrate` once both are accepted.
-- Independent of 0005_dividend_audit.sql. This file does not read or alter market tables.
-- No foreign keys. The app scopes every statement by the session user id.
--
-- Rollback: DROP TABLE auth_user_books. That deletes saved share counts, import drafts,
-- and idempotency results. It does not change companies, dividend_events, or qk.holdings.v1.
-- Nothing in this PR has applied this file. The earlier unapplied per-row shape is replaced
-- entirely; do not apply both.
--
-- Atomicity: @tidbcloud/serverless 0.3.0 can open begin() on a dedicated connection, which
-- sends BEGIN and then reuses that connection's TiDB-Session header. This store does not call
-- begin(). A shared execute() connection is not a transaction. The book, the idempotency
-- result, and draft consumption are one JSON document. A change is one INSERT or one
-- UPDATE ... WHERE user_id = ? AND version = ?. rowsAffected must be the number 1.
-- A stale writer sees 0 rows and does not change the document. This was not executed on TiDB.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS auth_user_books (
  user_id    CHAR(36)     NOT NULL,
  version    BIGINT UNSIGNED NOT NULL,
  document   MEDIUMTEXT   NOT NULL COMMENT 'Items, idempotency results, drafts, and vision attempts. No image bytes.',
  updated_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='One versioned holdings document per account. Single-statement compare-and-swap.';
