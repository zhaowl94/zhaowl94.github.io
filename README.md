# zhaowl94.github.io

一个无框架、无追踪的个人市场研究工具台。主页统一导航 7 个公开工具，数据型页面通过 GitHub Actions 生成静态快照，再部署到 GitHub Pages。

上线地址：[https://zhaowl94.github.io/](https://zhaowl94.github.io/)

## 公开工具

| 子页面                                                               | 主要功能                                                    | 页面刷新方式                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| [`/etf-premium/`](https://zhaowl94.github.io/etf-premium/)           | 纳指 100 / 标普 500 A 股 ETF 实时与历史溢价、排行、CSV 导出 | 读取最新发布快照                     |
| [`/ndx-valuation/`](https://zhaowl94.github.io/ndx-valuation/)       | 长期对数趋势、趋势偏离、MA200 偏离、分阶段回归              | 优先请求公开行情，失败时保留内置快照 |
| [`/bubble-monitor/`](https://zhaowl94.github.io/bubble-monitor/)     | 估值、趋势、情绪、集中度和信用利差综合风险温度              | 读取最新发布快照                     |
| [`/strategy-monitor/`](https://zhaowl94.github.io/strategy-monitor/) | 当前仓位信号、MA 参数、定投及一次性投入回测                 | 读取最新发布快照                     |
| [`/backtest-lab/`](https://zhaowl94.github.io/backtest-lab/)         | 动态仓位、月定投、再平衡、XIRR、回撤、夏普及参数遍历        | 读取最新发布快照                     |
| [`/qdii-similarity/`](https://zhaowl94.github.io/qdii-similarity/)   | QDII 搜索、申购状态、额度、净值及与三只基准基金的相似度     | 读取每周发布快照                     |
| [`/market-pulse/`](https://zhaowl94.github.io/market-pulse/)         | 纳指 100、标普 500、规则 Top 10、滚动播报与来源健康         | 读取美股时段约 15 分钟快照           |

GitHub Pages 不能运行常驻 Python/Node 服务，因此按钮负责绕过浏览器缓存、读取最近一次成功发布的数据；真正的抓取、计算与降级处理在 Actions 中执行。上游失败时保留最近有效值。

## 隐私边界

- 不使用 Cookie、访问统计、广告、远程字体或第三方运行时脚本。
- 只发布市场研究所需的公开行情与基金数据。
- 私人财务记录只保留在本地，不进入本仓库的 Pages 页面、站点地图或部署产物。
- QDII 发布文件是精简后的基金公开数据快照，不包含本地路径、账户或个人资产信息。
- Market Pulse 不调用 LLM，也不需要 API Key；公开文件只保留指数、规则 Top 10、播报和来源状态，不发布全量候选原始行情。

## 目录结构

```text
.
├── index.html                     # 研究工具台主页
├── etf-premium/                   # 跨境 ETF 溢价
├── ndx-valuation/                 # 纳指估值
├── bubble-monitor/                # 泡沫监控
├── strategy-monitor/              # 趋势策略
├── backtest-lab/                  # 动态配置回测
├── qdii-similarity/               # QDII 相似度
├── market-pulse/                  # 无 LLM 美股市场脉搏
├── data/tool-status.json          # 主页更新时间清单
├── scripts/                       # 数据生成、校验脚本与源数据
├── test/                          # 单元、浏览器、可访问性和隐私测试
└── .github/workflows/             # 验证、定时刷新与 Pages 部署
```

## 本地查看

主页可直接打开；读取 JSON/JS 快照的子页面建议通过本地 HTTP：

```powershell
npm.cmd ci
npm.cmd run serve
```

然后访问 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。项目使用 Node.js 24，依赖由锁文件固定。

## 验证

```powershell
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:e2e:windows
npm.cmd run check:external-links
npm.cmd run test:lighthouse
```

CI 同时覆盖 Ubuntu、Windows、Chromium、Firefox、WebKit、Chrome 与 Edge，并执行 WCAG 自动检查、隐私扫描和 Lighthouse 预算。

## 发布与更新

Pull Request 通过全部质量门后合并到 `master`，CI 部署 GitHub Pages。`Refresh research data` 工作流在工作日更新日频市场快照，并按周更新完整 QDII 相似度；`Refresh Market Pulse` 在覆盖美股常规交易时段的 UTC 窗口约每 15 分钟执行。两个工作流都可在 GitHub 的 Actions 页面手动触发。

本地也可一键重建无 LLM 快照：

```powershell
python scripts\update-market-pulse-data.py
```

## 许可证

HTML、CSS、JavaScript、测试和配置代码采用 [MIT License](LICENSE)。数据仅供研究，不构成投资建议。
