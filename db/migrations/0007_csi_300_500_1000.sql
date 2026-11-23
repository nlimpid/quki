-- CSI 300 / 500 / 1000 price + total-return twins.
-- Confirmed on CSIndex index-perf for the 2026-11-20 session:
--   000300 沪深300 <-> H00300 300收益
--   000905 中证500 <-> H00905 500收益
--   000852 中证1000 <-> H00852 中证1000全收益
-- Price history for 000300 starts 2002-01-04 (base close 1316.46, not 1000).
-- The other five publish a 2004-12-31 base print of 1000. 000852 has no
-- 2004-12-31 row; its first session is 2005-01-04.

INSERT INTO instruments (symbol, name, name_en, asset_type, exchange, currency, is_total_return, source, source_code, meta, status)
VALUES
  ('000300', '沪深300', 'CSI 300 Index', 'index', 'CSI', 'CNY', 0, 'csindex', '000300',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'history_start', '2002-01-04', 'base_value', 1000, 'twin_symbol', 'H00300'), 'active'),
  ('H00300', '300收益', 'CSI 300 Total Return Index', 'index', 'CSI', 'CNY', 1, 'csindex', 'H00300',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'base_value', 1000, 'twin_symbol', '000300'), 'active'),
  ('000905', '中证500', 'CSI Smallcap 500 Index', 'index', 'CSI', 'CNY', 0, 'csindex', '000905',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'base_value', 1000, 'twin_symbol', 'H00905'), 'active'),
  ('H00905', '500收益', 'CSI Smallcap 500 Total Return Index', 'index', 'CSI', 'CNY', 1, 'csindex', 'H00905',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'base_value', 1000, 'twin_symbol', '000905'), 'active'),
  ('000852', '中证1000', 'CSI 1000 Index', 'index', 'CSI', 'CNY', 0, 'csindex', '000852',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'history_start', '2005-01-04', 'base_value', 1000, 'twin_symbol', 'H00852'), 'active'),
  ('H00852', '中证1000全收益', 'CSI 1000 Total Return Index', 'index', 'CSI', 'CNY', 1, 'csindex', 'H00852',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'base_value', 1000, 'twin_symbol', '000852'), 'active')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  name_en = VALUES(name_en),
  is_total_return = VALUES(is_total_return),
  source_code = VALUES(source_code),
  meta = VALUES(meta),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

UPDATE instruments i
JOIN instruments t
  ON t.source = i.source
 AND t.symbol = JSON_UNQUOTE(JSON_EXTRACT(i.meta, '$.twin_symbol'))
SET i.related_id = t.id
WHERE i.source = 'csindex'
  AND i.symbol IN ('000300', 'H00300', '000905', 'H00905', '000852', 'H00852');
