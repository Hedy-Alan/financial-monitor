# 📈 Financial Monitor — 桌面财经面板

实时监控 **A股 / 港股 / 美股 / 外汇 / 大宗商品 / 加密货币** 行情，轻量 Node.js 服务 + Edge/Chrome App 模式窗口。

<p align="center">
  <img src="screenshot.png" alt="截图" width="80%">
</p>

## ✨ 功能

| 模块 | 能力 |
|------|------|
| 📌 **4 Tab 切换** | ⭐自选 / 🇨🇳A股 / 🌍美港股 / 🪙加密货币 |
| 📊 **大盘指数** | 上证/深证/创业板/科创50/道琼斯/纳斯达克/恒生，实时涨幅颜色 |
| 🔥 **涨跌排行** | A股/美股/港股各自 Top 10 涨幅榜 + 跌幅榜 |
| 🤖 **AI 交易信号** | MA5/10/30 均线分析 + 金叉死叉 + 量能异常 → 强烈买入~强烈卖出 5 档 |
| 📈 **K 线图** | 点击任意股票弹出 60 根 K 线 + MA5/MA10/MA30 均线叠加（可独立切换显隐） |
| 📰 **实时新闻** | 新浪财经 8 条快讯滚动，点击跳转原文 |
| 💰 **基金净值** | 天天基金 5 只热门基金每日净值 + 涨跌幅 |
| 🎨 **暗色主题** | 赛博朋克风格，红涨绿跌，无闪烁 |
| ➕ **在线管理** | 添加/删除自选股，localStorage 持久化 |

## 🚀 快速开始

```bash
git clone https://github.com/Hedy-Alan/financial-monitor.git
cd financial-monitor
npm install
npm start
```

> Windows 用户直接双击 `start.bat`

浏览器会自动以 App 模式打开 `http://localhost:9877`

### 在其他平台运行

```bash
# macOS / Linux — 浏览器普通模式
node server.js
# 打开 http://localhost:9877

# Chrome App 模式 (需安装 Chrome)
google-chrome --app=http://localhost:9877 --window-size=880,560
```

## 📂 项目结构

```
financial-monitor/
├── server.js         # Node.js 后端 (HTTP + WebSocket + 数据抓取)
├── index.html        # 前端仪表盘 (纯 HTML/CSS/JS)
├── start.bat         # Windows 一键启动
├── package.json
└── data/             # 自选股 + 提醒数据 (自动生成)
    ├── stocks.json
    └── alerts.json
```

## 📡 数据源

| 市场 | 接口 | 编码 |
|------|------|------|
| A股 | 腾讯财经 `qt.gtimg.cn` | GBK |
| 港股/美股 | 新浪财经 `hq.sinajs.cn` | GBK |
| 外汇 | 新浪财经 | GBK |
| 加密货币 | Gate.io `data.gateapi.io` | JSON |

全部 **免费**，无需 API Key。

## 🛠️ 技术栈

- Node.js 后端 — HTTP + WebSocket
- 纯原生前端 — 零框架，零构建步骤
- `iconv-lite` — GBK 编码转换
- `ws` — WebSocket 实时推送
- Edge/Chrome `--app` 模式 — 无边框桌面窗口

## 📄 License

MIT — 开源免费，随便用
