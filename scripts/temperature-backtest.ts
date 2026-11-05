import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  HORIZONS,
  MAPPING_SCORE_EPSILON,
  TEMPERATURE_MIN_SPREADS,
  TEMPERATURE_MIN_WEEKS,
  TEMPERATURE_Z_MIN_SPREADS,
  buildSignalRows,
  evaluateFrozen,
  runTemperatureStudy,
  type HorizonKey,
  type TemperatureCandidate,
  type TemperatureMapping,
  type UniverseStudy,
  type WindowReport,
} from "@quki/analytics";
import { dedupeBars, dropClonedBaseRows, parseSeedCsv, seedToDaily } from "@quki/ingest";
import type { DailyBar } from "@quki/types";

import { assertBacktestDatabase, persistTemperatureBacktest, connectTiDb } from "@quki/db";

type Universe = {
  key: string;
  title: string;
  role: string;
  price: string;
  totalReturn: string;
  broad: string;
};

const UNIVERSES: readonly Universe[] = [
  {
    key: "dividend-h20903",
    title: "中证红利 000922 / H00922 vs 中证A股全收益 H20903",
    role: "primary",
    price: "000922",
    totalReturn: "H00922",
    broad: "H20903",
  },
  {
    key: "dividend-h00985",
    title: "中证红利 000922 / H00922 vs 中证全指全收益 H00985",
    role: "robustness",
    price: "000922",
    totalReturn: "H00922",
    broad: "H00985",
  },
  {
    key: "lowvol-h20903",
    title: "红利低波 H30269 / H20269 vs 中证A股全收益 H20903",
    role: "lowvol",
    price: "H30269",
    totalReturn: "H20269",
    broad: "H20903",
  },
  {
    key: "lowvol-h00985",
    title: "红利低波 H30269 / H20269 vs 中证全指全收益 H00985",
    role: "lowvol-robustness",
    price: "H30269",
    totalReturn: "H20269",
    broad: "H00985",
  },
];

function loadBars(symbol: string): DailyBar[] {
  const text = readFileSync(resolve("data/seed", `${symbol}.csv`), "utf8");
  return seedToDaily(dropClonedBaseRows(dedupeBars(parseSeedCsv(text))));
}

function pct(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function cell(value: string): string {
  return value.replaceAll("|", "/");
}

function candidateLabel(candidate: TemperatureCandidate): string {
  if (candidate.mapping === "quantile") return `Q w=${candidate.w.toFixed(1)}`;
  if (candidate.mapping === "zscore")
    return `Z w=${candidate.w.toFixed(1)} k=${candidate.k?.toFixed(1)}`;
  return `R ${candidate.id.replace("R-", "")} (${candidate.paCold}/${candidate.pbCold}, ${candidate.paHot}/${candidate.pbHot})`;
}

function bucketTable(report: WindowReport, horizon: HorizonKey, side: "abs" | "rel"): string {
  const lines = [
    "| 桶 | n | 均值 | 中位 | P25 | P75 | 胜率>0 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const bucket of report.buckets) {
    const dist = bucket.byHorizon[horizon][side];
    lines.push(
      `| ${bucket.label} ${bucket.lo}–${bucket.hi} | ${dist.n} | ${pct(dist.mean)} | ${pct(dist.median)} | ${pct(dist.p25)} | ${pct(dist.p75)} | ${pct(dist.winRate, 1)} |`,
    );
  }
  const rho = report.bucketSpearman[horizon][side];
  lines.push("");
  lines.push(
    `桶序与均值的 Spearman（负值表示越热的桶后续收益越低）：${num(rho)}。样本不足 20 的桶不进入这条相关。`,
  );
  return lines.join("\n");
}

function decileTable(report: WindowReport): string {
  const lines = [
    "| 分位 | n | 绝对均值 | 绝对胜率 | 相对均值 | 相对胜率 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const bucket of report.deciles) {
    const abs = bucket.byHorizon["1Y"].abs;
    const rel = bucket.byHorizon["1Y"].rel;
    lines.push(
      `| ${bucket.label} | ${rel.n} | ${pct(abs.mean)} | ${pct(abs.winRate, 1)} | ${pct(rel.mean)} | ${pct(rel.winRate, 1)} |`,
    );
  }
  return lines.join("\n");
}

function extremeTable(report: WindowReport): string {
  const lines = [
    "| 阈值 | 窗口 | 冷 n | 冷绝对均值 | 冷相对均值 | 冷相对胜率 | 热 n | 热绝对均值 | 热相对均值 | 热相对<0 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const zone of report.extremeGrid) {
    for (const horizon of HORIZONS) {
      const cold = zone.byHorizon[horizon.key].cold;
      const hot = zone.byHorizon[horizon.key].hot;
      lines.push(
        `| ${zone.coldMax}/${zone.hotMin} | ${horizon.key} | ${cold.rel.n} | ${pct(cold.abs.mean)} | ${pct(cold.rel.mean)} | ${pct(cold.rel.winRate, 1)} | ${hot.rel.n} | ${pct(hot.abs.mean)} | ${pct(hot.rel.mean)} | ${pct(hot.rel.shortfallRate, 1)} |`,
      );
    }
  }
  return lines.join("\n");
}

function mappingName(mapping: TemperatureMapping): string {
  if (mapping === "quantile") return "Q 分位加权";
  if (mapping === "zscore") return "Z logistic";
  return "R 规则树";
}

function render(
  studies: {
    universe: Universe;
    study: UniverseStudy;
    shipped: ReturnType<typeof evaluateFrozen>;
  }[],
): string {
  const primary = studies[0];
  if (!primary) throw new Error("no primary universe");
  const choice = primary.study.candidate;
  const extremes = primary.study.extremes;
  const lines: string[] = [];
  lines.push("# 红利温度计 v1 回测");
  lines.push("");
  lines.push("离线计算，读 `data/seed`，不写生产库。复现：`pnpm temperature:backtest`。");
  lines.push("");
  lines.push("## 算法");
  lines.push("");
  lines.push("高分表示贵 / 过热，低分表示便宜。温度是 1–100 的整数。");
  lines.push("");
  lines.push(
    "- **信号 A**：价格指数周收盘 / MA55 的 expanding 分位（与概览 `percentileStrictlyBelow` 相同）。用最近一个已结束的 ISO 周向前填充到日，周三看不到本周周五的收盘。中证红利用 `000922`，红利低波用 `H30269`。",
  );
  lines.push(
    "- **信号 B**：全收益 40 日收益差 `S = ret(红利全收益) − ret(宽基全收益)` 的 expanding 分位，与轮动 `sPercentile` 同一公式。中证红利用 `H00922`，红利低波用 `H20269`。主宽基 `H20903`，稳健性 `H00985`。",
  );
  lines.push(
    `- 周样本至少 ${TEMPERATURE_MIN_WEEKS}、收益差样本至少 ${TEMPERATURE_MIN_SPREADS} 才发布 Q / R。Z 还要求收益差样本 ${TEMPERATURE_Z_MIN_SPREADS}，μ/σ 只用截至当日的 expanding 样本。`,
  );
  lines.push("- **Q**：`T = clamp(1, 100, round(w P_A + (1−w) P_B))`，`w ∈ {0.5, 0.6, 0.7}`。");
  lines.push(
    "- **Z**：`z = w z_A + (1−w) z_B`，`T = round(1 + 99 / (1 + e^{−k z}))`，`k ∈ {0.8, 1.0, 1.2}`。z = 0 时 T = 51。",
  );
  lines.push(
    "- **R**：`P_A`、`P_B` 同时不低于热阈值时 `T = 85 + floor((P_A+P_B)/40)`；同时不高于冷阈值时 `T = 15 − floor((200−P_A−P_B)/40)`；否则 `round(0.6 P_A + 0.4 P_B)`。阈值只试 base 20/30–80/70、tight 15/25–85/75、wide 25/35–75/65。",
  );
  lines.push("");
  lines.push("## 选型");
  lines.push("");
  lines.push(
    "前瞻收益是信号日收盘到之后第 21 / 63 / 126 / 242 个共同交易日收盘。绝对收益用红利全收益，相对收益是它减去同一宽基的全收益。没有交易成本。日频收益重叠，所以 Spearman 只用来排序，不作为独立样本的显著性。",
  );
  lines.push("");
  lines.push(
    `走步：训练窗 5 个日历年，下一年为测试。训练样本的 1 年标签必须落在测试年之前。每条映射先在测试年 ≤ 2018 的折上冻结一个参数（训练窗众数），再把这个冻结模型拿到这些测试折上打分。映射分数是这些分数的平均，不是「每年重选参数」的分数。正分表示越热之后相对收益越低。Q 与最优分差不超过 ${MAPPING_SCORE_EPSILON} 时选 Q。`,
  );
  lines.push("");
  lines.push(
    "生产权重只从测试年 ≤ 2018 的折里取众数。平票用「信号日和 1Y 标签都 ≤ 2018-12-31」的单窗结果。2019 及以后只报告一次，不参与选 w / k / 规则 / 极端阈值。极端阈值在这个预 2019 窗口上从 10/90、15/86、20/80 里选，两边都要有至少 30 个 1Y 结果，目标是冷区相对均值减热区相对均值，平票留 10/90。",
  );
  lines.push("");
  lines.push("## 锁定的默认");
  lines.push("");
  lines.push(`- 映射：**${mappingName(primary.study.chosenMapping)}**（${choice.id}）`);
  lines.push(`- 参数：${candidateLabel(choice)}`);
  lines.push(
    `- 极端区：${extremes.coldMax} / ${extremes.hotMin}${extremes.qualified ? "" : "（预 2019 样本不足，保留起点 10/90）"}`,
  );
  lines.push(
    `- 可比样本：${primary.study.comparableStart} → ${primary.study.comparableEnd}，n=${primary.study.comparableN}`,
  );
  lines.push(`- P_A 与 P_B 的 Pearson：${num(primary.study.paPbPearson)}`);
  lines.push(`- 预 2019 训练分：${num(primary.study.ownHoldout.trainScore)}`);
  lines.push(
    `- 2019+ 分数（−Spearman 1Y 相对）：${num(primary.study.ownHoldout.outOfSample.score)}`,
  );
  lines.push(
    `- 2019+ 1Y 绝对收益 Spearman：${num(primary.study.ownHoldout.outOfSample.spearmanAbs1y)}`,
  );
  lines.push(`- 2019+ 月末分数：${num(primary.study.ownHoldout.outOfSample.monthEndScore)}`);
  for (const note of primary.study.notes) lines.push(`- 注：${note}`);
  lines.push("");
  lines.push("代码里的对应常量是 `TEMPERATURE_V1`。");
  lines.push("");
  lines.push("### 主样本映射对照（各自用预 2019 冻结的参数，2019+ 只评一次）");
  lines.push("");
  lines.push(
    "| 映射 | 冻结参数 | 冻结模型走步分 | 每年重选的走步分 | 预 2019 训练分 | 2019+ 分 | 2019+ 月末 | 2019+ 桶 Spearman 1Y 相对 |",
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const mapping of ["quantile", "zscore", "rule"] as const) {
    const hold = primary.study.mappingHoldout[mapping];
    const score = primary.study.mappingScores[mapping];
    lines.push(
      `| ${mappingName(mapping)} | ${cell(candidateLabel(hold.candidate))} | ${num(score.frozenTestScore)} | ${num(score.meanTestScore)} | ${num(hold.trainScore)} | ${num(hold.outOfSample.score)} | ${num(hold.outOfSample.monthEndScore)} | ${num(hold.outOfSample.bucketSpearman["1Y"].rel)} |`,
    );
  }
  lines.push("");
  lines.push("### 主样本走步");
  lines.push("");
  lines.push("| 测试年 | 训练 n | 测试 n | Q | Q 测试分 | Z | Z 测试分 | R | R 测试分 |");
  lines.push("| ---: | ---: | ---: | --- | ---: | --- | ---: | --- | ---: |");
  for (const fold of primary.study.folds) {
    const q = fold.byMapping.quantile;
    const z = fold.byMapping.zscore;
    const r = fold.byMapping.rule;
    lines.push(
      `| ${fold.testYear} | ${fold.trainN} | ${fold.testN} | ${q.candidateId} | ${num(q.testScore)} | ${z.candidateId} | ${num(z.testScore)} | ${r.candidateId} | ${num(r.testScore)} |`,
    );
  }
  lines.push("");
  lines.push(`极端阈值折内投票（选择折）：${primary.study.extremeVotes.join(", ") || "—"}。`);
  lines.push("");
  lines.push("## 主样本桶表");
  lines.push("");
  lines.push("下面是锁定参数在 2019-01-01 之后的分布。收益是持有期收益，不是年化。");
  lines.push("");
  for (const horizon of HORIZONS) {
    lines.push(`### ${horizon.key} 绝对（H00922 全收益）`);
    lines.push("");
    lines.push(bucketTable(primary.study.ownHoldout.outOfSample, horizon.key, "abs"));
    lines.push("");
    lines.push(`### ${horizon.key} 相对 H20903`);
    lines.push("");
    lines.push(bucketTable(primary.study.ownHoldout.outOfSample, horizon.key, "rel"));
    lines.push("");
  }
  lines.push("### 2019+ 十分位，1Y");
  lines.push("");
  lines.push(decileTable(primary.study.ownHoldout.outOfSample));
  lines.push("");
  lines.push("### 极端区（2019+，三组阈值都列出；加粗的选择是预 2019 定的，不是在这段上重选的）");
  lines.push("");
  lines.push(`选用 ${extremes.coldMax}/${extremes.hotMin}。`);
  lines.push("");
  lines.push(extremeTable(primary.study.ownHoldout.outOfSample));
  lines.push("");
  lines.push("### 2019+ 三个映射的 1Y 相对均值");
  lines.push("");
  lines.push("| 桶 | Q 均值 | Q n | Z 均值 | Z n | R 均值 | R n |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  const qBuckets = primary.study.mappingHoldout.quantile.outOfSample.buckets;
  const zBuckets = primary.study.mappingHoldout.zscore.outOfSample.buckets;
  const rBuckets = primary.study.mappingHoldout.rule.outOfSample.buckets;
  for (let i = 0; i < qBuckets.length; i += 1) {
    const q = qBuckets[i]?.byHorizon["1Y"].rel;
    const z = zBuckets[i]?.byHorizon["1Y"].rel;
    const r = rBuckets[i]?.byHorizon["1Y"].rel;
    const label = qBuckets[i]?.label ?? "";
    lines.push(
      `| ${label} | ${pct(q?.mean ?? null)} | ${q?.n ?? 0} | ${pct(z?.mean ?? null)} | ${z?.n ?? 0} | ${pct(r?.mean ?? null)} | ${r?.n ?? 0} |`,
    );
  }
  lines.push("");
  lines.push("## 样本内对照（信号日 ≤ 2018-12-31）");
  lines.push("");
  lines.push(
    `锁定参数的样本内 1Y 相对分：${num(primary.study.ownHoldout.inSample.score)}。月末：${num(primary.study.ownHoldout.inSample.monthEndScore)}。晚于约 2018 年初的信号，其 1Y 结果会落到 2019，这段表包含它们；选型用的训练标签则要求 1Y 到期日也 ≤ 2018-12-31。`,
  );
  lines.push("");
  lines.push(bucketTable(primary.study.ownHoldout.inSample, "1Y", "rel"));
  lines.push("");
  lines.push("## 其余三条腿");
  lines.push("");
  lines.push(
    "生产参数沿用主样本，不在这些腿上重选。表是该冻结参数的 2019+ 1Y 相对收益。各腿自己的走步选择写在表后，只作稳健性，不改默认。",
  );
  lines.push("");
  for (const item of studies.slice(1)) {
    lines.push(`### ${item.universe.title}`);
    lines.push("");
    lines.push(
      `可比样本 ${item.study.comparableStart} → ${item.study.comparableEnd}，n=${item.study.comparableN}。P_A–P_B Pearson ${num(item.study.paPbPearson)}。`,
    );
    lines.push("");
    lines.push(
      `本腿自己的走步会选 **${mappingName(item.study.chosenMapping)}** ${item.study.candidate.id}，极端区 ${item.study.extremes.coldMax}/${item.study.extremes.hotMin}。`,
    );
    lines.push("");
    lines.push("| 映射 | 冻结模型走步分 | 2019+ 分（本腿冻结参数） |");
    lines.push("| --- | ---: | ---: |");
    for (const mapping of ["quantile", "zscore", "rule"] as const) {
      const score = item.study.mappingScores[mapping];
      const hold = item.study.mappingHoldout[mapping];
      lines.push(
        `| ${mappingName(mapping)} | ${num(score.frozenTestScore)} | ${num(hold.outOfSample.score)} |`,
      );
    }
    lines.push("");
    lines.push("冻结的生产参数在这条腿上的 2019+ 1Y 相对：");
    lines.push("");
    lines.push(bucketTable(item.shipped.outOfSample, "1Y", "rel"));
    lines.push("");
    lines.push(
      `1Y 绝对均值（中性桶作参照见上表）。分数 ${num(item.shipped.outOfSample.score)}，月末 ${num(item.shipped.outOfSample.monthEndScore)}。`,
    );
    lines.push("");
    const shippedExtreme = item.shipped.outOfSample.extremes[0];
    if (shippedExtreme) {
      const cold = shippedExtreme.byHorizon["1Y"].cold.rel;
      const hot = shippedExtreme.byHorizon["1Y"].hot.rel;
      lines.push(
        `极端区 ${shippedExtreme.coldMax}/${shippedExtreme.hotMin} 的 1Y 相对：冷 n=${cold.n} 均值 ${pct(cold.mean)} 胜率 ${pct(cold.winRate, 1)}；热 n=${hot.n} 均值 ${pct(hot.mean)} 低于 0 的比例 ${pct(hot.shortfallRate, 1)}。`,
      );
      lines.push("");
    }
  }
  lines.push("## 口径");
  lines.push("");
  lines.push("- 同日收盘得到 T，收益从该收盘持有到未来收盘。不可交易，也不扣费。");
  lines.push("- 分位、μ/σ、权重、规则阈值和极端阈值都不用测试年的结果来选。");
  lines.push(
    "- 三条映射共用同一段可比样本（Z 的 μ/σ 已经可用的日期）。Q 的入库序列可以更早开始，早出来的那段不在这张对照表里。",
  );
  lines.push("- 宽基与红利某一边缺日的会话被丢掉。前瞻窗口按共同交易日计数。");
  return lines.join("\n");
}

const cache = new Map<string, DailyBar[]>();
function bars(symbol: string): DailyBar[] {
  const cached = cache.get(symbol);
  if (cached) return cached;
  const loaded = loadBars(symbol);
  cache.set(symbol, loaded);
  return loaded;
}

const studies = UNIVERSES.map((universe) => {
  const rows = buildSignalRows({
    priceDaily: bars(universe.price),
    totalReturnDaily: bars(universe.totalReturn),
    broadDaily: bars(universe.broad),
  });
  const study = runTemperatureStudy(rows);
  return { universe, rows, study };
});

const primary = studies[0];
if (!primary) throw new Error("missing primary study");
const shipped = studies.map((item) => ({
  universe: item.universe,
  study: item.study,
  shipped: evaluateFrozen(item.rows, primary.study.candidate, {
    coldMax: primary.study.extremes.coldMax,
    hotMin: primary.study.extremes.hotMin,
  }),
}));

const markdown = `${render(shipped)}\n`;
const outDir = resolve("docs");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "temperature-v1-backtest.md");
writeFileSync(outPath, markdown);

const decision = {
  mapping: primary.study.chosenMapping,
  candidateId: primary.study.candidate.id,
  w: primary.study.candidate.w,
  k: primary.study.candidate.k,
  paCold: primary.study.candidate.paCold,
  pbCold: primary.study.candidate.pbCold,
  paHot: primary.study.candidate.paHot,
  pbHot: primary.study.candidate.pbHot,
  coldMax: primary.study.extremes.coldMax,
  hotMin: primary.study.extremes.hotMin,
  qualified: primary.study.extremes.qualified,
  scores: primary.study.mappingScores,
  trainScore: primary.study.ownHoldout.trainScore,
  oosScore: primary.study.ownHoldout.outOfSample.score,
  notes: primary.study.notes,
  universes: studies.map((item) => ({
    key: item.universe.key,
    chosen: item.study.candidate.id,
    mapping: item.study.chosenMapping,
    oos: item.study.ownHoldout.outOfSample.score,
    scores: item.study.mappingScores,
  })),
};
writeFileSync(
  resolve(outDir, "temperature-v1-decision.json"),
  `${JSON.stringify(decision, null, 2)}\n`,
);
console.log(`wrote ${outPath}`);
console.log(`PRODUCTION ${JSON.stringify(decision)}`);

const persistUrl = process.argv.includes("--persist")
  ? process.env.TIDB_QUKI_DATABASE_URL
  : undefined;
if (persistUrl) {
  assertBacktestDatabase(persistUrl);
  const start = primary.study.comparableStart ?? "2007-01-01";
  const end = primary.study.comparableEnd ?? "2026-11-03";
  await persistTemperatureBacktest(connectTiDb(persistUrl), persistUrl, {
    name: "dividend temperature v1",
    params: decision,
    instrumentIds: UNIVERSES.map((universe) => universe.totalReturn),
    startDate: start,
    endDate: end,
    metrics: decision,
  });
  console.log("persisted compact summary to backtest_runs");
}
