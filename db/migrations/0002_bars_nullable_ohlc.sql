-- Adaptation of the phase-1 schema (see PR notes).
-- CSIndex publishes close-only sessions: H20269/H00922 entirely, and H30269
-- from 2016-06-14 through 2018-06 (including the 2018-06-18 zero-volume row).
-- The UI renders those sessions as a close line, so open/high/low must be
-- nullable. `close` stays NOT NULL. Amount remains the source figure in 亿元
-- (see data/SOURCES.md); volume remains shares.

ALTER TABLE bars
  MODIFY COLUMN open DECIMAL(18,6) NULL COMMENT 'NULL when the source published close only',
  MODIFY COLUMN high DECIMAL(18,6) NULL COMMENT 'NULL when the source published close only',
  MODIFY COLUMN low DECIMAL(18,6) NULL COMMENT 'NULL when the source published close only';
