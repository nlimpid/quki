-- CANDIDATE. NOT APPLIED. Do not run this file from a worker, a cron, or an agent.
-- This file is in db/review, not db/migrations, so `pnpm migrate` does not apply it.
--
-- Filename: 0008_auth_holdings.sql.
-- Master already contains 0006_auth.sql. This file does not edit 0006 or any
-- earlier migration. The unmerged holdings branch owns 0007_holdings.sql
-- (table auth_user_books, one JSON document per user). This file does not use
-- that name and does not create auth_user_books.
-- workers/crawler/src/index.ts hardcodes 0001 through 0005 only. Do not add
-- 0006 or 0008 to that list.
--
-- pnpm migrate applies every *.sql in db/migrations whose filename is missing
-- from schema_migrations. This file is outside that directory. We do not
-- execute that command. Whether production has applied 0006_auth.sql was NOT
-- CHECKED. Do not describe 0006 as unapplied.
-- user_id is the internal UUID from auth_identities, not a Clerk user id.
--
-- Columns are the primary key (user_id, code) plus shares, version, updated_at.
-- No KEY (user_id). InnoDB and TiDB use the leftmost prefix of the primary key
-- for WHERE user_id = ?. A second user index would be redundant.
-- No foreign key, matching 0006_auth.sql.
-- updated_at is written by the application. There is no ON UPDATE, so a
-- rejected write does not change the clock.
--
-- version is CHAR(32), 32 lowercase hex characters, not BIGINT.
-- TiDB (the @tidbcloud/serverless MySQL protocol this app uses) does not keep
-- a per-key counter after DELETE of the only row. An INSERT that stores
-- version 1 after that DELETE matches a client that still holds version 1,
-- and the stale update resurrects or overwrites the new row. That is the
-- delete/reinsert ABA case. AUTO_INCREMENT is also the wrong tool: it is a
-- table counter, it can go backwards across a restart cache, and it is not
-- the compare value the client already read.
-- Each successful write stores a new 128-bit value from crypto.getRandomValues
-- in the Worker. The statement does not call UUID(). The application returns
-- that value to the client. A later insert cannot reuse it in any practical
-- collision. A stale WHERE version = ? then matches zero rows.
-- CHAR(32) is exactly 32 characters, so the PAD SPACE rule does not make two
-- different versions compare equal. The column uses utf8mb4_bin.
--
-- shares is INT UNSIGNED. That type still allows 0 and values above
-- 1000000000, so the range is not implied by the type. The CHECK names
-- 1..1000000000. TiDB accepts CHECK constraints; this file was not executed,
-- so enforcement was not observed. The application rejects the same range
-- before the statement.
--
-- The application also requires companies.code with listing_status = 'listed'
-- and market IN ('SH','SZ') before a write. A six-digit string is not enough.
-- This table does not foreign-key to companies. A future OCR confirmation
-- must call the same create/update statements. This file has no image, draft,
-- or quota column.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS auth_holdings (
  user_id    CHAR(36)     NOT NULL,
  code       CHAR(6)      NOT NULL,
  shares     INT UNSIGNED NOT NULL,
  version    CHAR(32)     NOT NULL COMMENT '32 lowercase hex chars. New random value on every successful write. Never reused.',
  updated_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id, code),
  CONSTRAINT auth_holdings_shares CHECK (shares >= 1 AND shares <= 1000000000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
  COMMENT='One share count per account and listed code. Single-statement compare-and-swap.';
