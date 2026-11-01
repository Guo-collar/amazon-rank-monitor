# 亚马逊关键词排名监控（云端版）

通过 GitHub Actions 每 4 小时自动抓取亚马逊关键词自然排名，并推送飞书群通知。**不依赖本地电脑，关机也能正常运行。**

## 监控对象

- ASIN: `B0H1X8PBZX`
- 站点: `www.amazon.com`（美国站）
- 关键词:
  1. `wireless cat water fountain`
  2. `cordless cat water fountain`
  3. `cat water fountain wireless`

## 工作原理

```
GitHub Actions cron（每4小时）
  → Playwright 浏览器抓取搜索结果页，定位 ASIN 自然排名
  → 对比 rank_history.json 历史记录，诊断排名变化
  → 通过飞书群机器人 Webhook 推送通知
  → 提交 rank_history.json 回仓库，实现跨运行持久化
```

## 部署步骤

1. 创建 GitHub 仓库，推送本目录代码。
2. 在仓库 `Settings → Secrets and variables → Actions` 中添加：
   - `FEISHU_WEBHOOK`：你的飞书群机器人 Webhook 地址。
3. 手动触发一次 `workflow_dispatch` 验证，或等待下次 cron 自动运行。

## 注意事项

- 飞书 Webhook 通过 GitHub Secrets 注入，不写入代码，公开仓库也安全。
- 排名数据来自实时抓取，可能受亚马逊反爬影响；脚本已内置反爬重试逻辑。
- GitHub Actions 免费额度：公开仓库无限，私有仓库每月 2000 分钟（本任务远够用）。
