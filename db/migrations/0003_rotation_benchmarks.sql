-- Benchmarks for 轮动三棱镜. Factsheets (2026): 930903 ↔ 全收益 H20903,
-- 000985 ↔ 全收益 H00985. Price legs stay so a pair can fall back when a
-- benchmark has no total-return twin.

INSERT INTO instruments (symbol, name, name_en, asset_type, exchange, currency, is_total_return, source, source_code, meta, status)
VALUES
  ('930903', '中证A股', 'CSI China A Share Index', 'index', 'CSI', 'CNY', 0, 'csindex', '930903',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '1999-12-31', 'history_start', '2005-01-04', 'base_value', 1000, 'twin_symbol', 'H20903', 'note', '1999-12-31 row clones 2005-01-04 and is dropped'), 'active'),
  ('H20903', '中证A股全收益', 'CSI China A Share Total Return Index', 'index', 'CSI', 'CNY', 1, 'csindex', 'H20903',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '1999-12-31', 'history_start', '2005-01-04', 'twin_symbol', '930903'), 'active'),
  ('000985', '中证全指', 'CSI All Share Index', 'index', 'CSI', 'CNY', 0, 'csindex', '000985',
   JSON_OBJECT('publisher', 'CSI', 'base_date', '2004-12-31', 'base_value', 1000, 'twin_symbol', 'H00985'), 'active'),
  ('H00985', '中证全指全收益', 'CSI All Share Total Return Index', 'index', 'CSI', 'CNY', 1, 'csindex', 'H00985',
   JSON_OBJECT('publisher', 'CSI', 'twin_symbol', '000985'), 'active')
AS new
ON DUPLICATE KEY UPDATE
  name = new.name,
  name_en = new.name_en,
  is_total_return = new.is_total_return,
  source_code = new.source_code,
  meta = new.meta,
  status = new.status,
  updated_at = CURRENT_TIMESTAMP(3);

UPDATE instruments i
JOIN instruments t
  ON t.source = i.source
 AND t.symbol = JSON_UNQUOTE(JSON_EXTRACT(i.meta, '$.twin_symbol'))
SET i.related_id = t.id
WHERE i.source = 'csindex'
  AND i.symbol IN ('930903', 'H20903', '000985', 'H00985');
