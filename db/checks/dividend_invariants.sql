-- Read-only dividend checks. Do not run these against production from this PR.
-- They are SELECT-only stand-ins for a dbt-style gate: no Great Expectations, no Deequ.
-- A clean database returns zero rows from each statement.

-- ex_dividend_date >= equity_record_date when both are present
SELECT code, ex_dividend_date, equity_record_date
FROM dividend_events
WHERE ex_dividend_date IS NOT NULL
  AND equity_record_date IS NOT NULL
  AND ex_dividend_date < equity_record_date;

-- cash, bonus, and transfer are non-negative when present
SELECT code, ex_dividend_date, cash_div_pretax_per_10, bonus_ratio_per_10, transfer_ratio_per_10
FROM dividend_events
WHERE cash_div_pretax_per_10 < 0
   OR bonus_ratio_per_10 < 0
   OR transfer_ratio_per_10 < 0;

-- event_key is unique (the unique index should already enforce this)
SELECT event_key, COUNT(*) AS copies
FROM dividend_events
GROUP BY event_key
HAVING COUNT(*) > 1;
