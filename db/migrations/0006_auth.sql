-- Login sessions for quki.cc.
-- NOT APPLIED. Do not run this file from a worker, a cron, or an agent.
-- Review it, then apply on purpose with `pnpm migrate` after the schema is accepted.
-- Independent of 0005_dividend_audit.sql. This file does not read or alter dividend tables.
-- No foreign keys: the rest of the schema enforces relationships in the app.
-- Session tokens, OAuth state, PKCE verifiers, and nonces are server-side.
-- The browser receives only an opaque session cookie and a CSRF token.
--
-- issuer and subject are VARBINARY, not VARCHAR.
-- utf8mb4_unicode_ci folds letter case. utf8mb4_bin distinguishes case but is
-- PAD SPACE, so trailing spaces compare equal. VARBINARY compares the stored
-- bytes and keeps trailing bytes. The table default collation does not apply
-- to these two columns. 512 + 512 is under the 3072-byte index limit.
-- The HTTP driver binds a Uint8Array parameter as a 0x hex literal.
-- This file is not executed by tests or by the crawler migrate list.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS auth_users (
  id           CHAR(36)     NOT NULL,
  issuer       VARBINARY(512) NOT NULL COMMENT 'UTF-8 bytes of the OIDC iss claim. Case and trailing bytes count.',
  subject      VARBINARY(512) NOT NULL COMMENT 'UTF-8 bytes of sub. Case and trailing bytes count.',
  display_name VARCHAR(40)  NULL COMMENT 'Optional label. Not an email or phone fallback.',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_auth_users_identity (issuer, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Accounts keyed by verified issuer and sub. No holdings and no email column.';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id          CHAR(36)    NOT NULL,
  user_id     CHAR(36)    NOT NULL,
  token_hash  CHAR(64)    NOT NULL COMMENT 'SHA-256 hex of the cookie token. The raw token is not stored.',
  csrf_token  VARCHAR(64) NOT NULL COMMENT 'Logout synchronizer. Not a session credential.',
  expires_at  DATETIME(3) NOT NULL,
  revoked_at  DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_auth_sessions_token (token_hash),
  KEY idx_auth_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Revocable opaque sessions. 14-day absolute expiry is also enforced in the app.';

CREATE TABLE IF NOT EXISTS auth_oauth_transactions (
  id            CHAR(36)     NOT NULL,
  token_hash    CHAR(64)     NOT NULL COMMENT 'SHA-256 hex of the short-lived qk_oauth cookie.',
  state_secret  VARCHAR(128) NOT NULL,
  code_verifier VARCHAR(128) NOT NULL,
  nonce         VARCHAR(128) NOT NULL,
  return_to     VARCHAR(512) NOT NULL COMMENT 'Already restricted to a same-origin path.',
  expires_at    DATETIME(3)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_auth_oauth_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Consumed by one conditional DELETE that also matches state_secret. A wrong state does not delete the row.';
