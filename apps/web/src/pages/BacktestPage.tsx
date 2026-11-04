export function BacktestPage() {
  return (
    <section className="card backtest">
      <h1>回测即将推出</h1>
      <p>
        下一阶段会在同一套周线与 MA55
        上比较规则和买入持有。页面将给出年化收益、最大回撤、胜率、平均持有周数，以及权益曲线和成交明细。
      </p>
      <p>
        策略挂在 <code>@quki/analytics</code> 的注册表上，第一支规则是 <code>ma55_band</code>：
      </p>
      <ul>
        <li>周收盘低于 MA55 的 90% 买入</li>
        <li>回到 MA55（100%）卖出</li>
        <li>也可按 85% / 90% / 95% 分档定投，结果写入 backtest_runs / trades / equity</li>
      </ul>
      <p>
        红利策略的收益很大一部分来自分红。正式回测应使用全收益指数（红利低波 H20269，中证红利
        H00922），这两条序列已经在数据模型里。
      </p>
    </section>
  );
}
