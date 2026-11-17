-- REVIEW CANDIDATE. This file is not in db/migrations, so `pnpm migrate` does not see it.
-- We do not execute this file. Whether production has applied 0006_auth.sql was NOT CHECKED.
-- Do not edit or delete 0006_auth.sql. It is merged history.
-- This table does not import OIDC users and has no email column.
-- id is a UUID this app generates. subject holds the Clerk user id bytes and is not CHAR(36).
-- issuer and subject are VARBINARY so case and trailing bytes stay distinct.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS auth_identities (
  id         CHAR(36)       NOT NULL,
  issuer     VARBINARY(512) NOT NULL,
  subject    VARBINARY(512) NOT NULL,
  created_at DATETIME(3)    NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_auth_identities (issuer, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Verified iss and sub to an internal UUID. No email and no session token.';
