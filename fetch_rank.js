/**
 * 亚马逊关键词自然排名抓取脚本（云端版，供 GitHub Actions 调用）
 * 通过 Playwright 打开搜索页定位目标 ASIN 的自然排名
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  asin: 'B0H1X8PBZX',
  marketplace: 'www.amazon.com',
  keywords: [
    'wireless cat water fountain',
    'cordless cat water fountain',
    'cat water fountain wireless',
  ],
  maxPages: 5,
  timeout: 30000,
  headless: true,
};

const HISTORY_FILE = path.join(__dirname, 'rank_history.json');
const RESULT_FILE = path.join(__dirname, 'last_result.json');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSearchResults(html) {
  const regex = /data-asin="([A-Z0-9]{10})"/g;
  const seen = new Set();
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1] && !seen.has(match[1])) {
      seen.add(match[1]);
    }
  }
  return Array.from(seen);
}

async function fetchRankForKeyword(page, keyword) {
  const searchUrl = `https://${CONFIG.marketplace}/s?k=${encodeURIComponent(keyword)}`;
  console.log(`  搜索: ${keyword}`);

  for (let p = 1; p <= CONFIG.maxPages; p++) {
    const url = p === 1 ? searchUrl : `${searchUrl}&page=${p}`;
    let html = '';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
      await page.waitForTimeout(3000);
      html = await page.content();
    } catch (e) {
      console.log(`  第${p}页加载失败: ${e.message}`);
      return { rank: null, page: null, error: `page${p}加载失败` };
    }

    if (html.includes('bm-verify')) {
      console.log(`  第${p}页触发反爬，等待重试...`);
      await sleep(6000);
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
        html = await page.content();
      } catch (e) {}
    }

    const asins = parseSearchResults(html);
    const idx = asins.indexOf(CONFIG.asin);
    if (idx !== -1) {
      const rank = (p - 1) * 48 + idx + 1;
      console.log(`  ✓ 找到，自然排名 #${rank}`);
      return { rank, page: p, error: null };
    }
    console.log(`  第${p}页${asins.length}个ASIN未找到，继续...`);
    await sleep(2000 + Math.random() * 3000);
  }

  console.log(`  ✗ 前${CONFIG.maxPages}页未找到`);
  return { rank: null, page: null, error: 'not_found_in_top_pages' };
}

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
      return { records: [] };
    }
  }
  return { records: [] };
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

async function main() {
  const browser = await chromium.launch({ headless: CONFIG.headless });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  const record = {
    timestamp: new Date().toISOString(),
    marketplace: CONFIG.marketplace,
    asin: CONFIG.asin,
    results: [],
  };

  console.log(`[${record.timestamp}] 开始抓取 ${CONFIG.asin} 排名...`);
  for (const kw of CONFIG.keywords) {
    const r = await fetchRankForKeyword(page, kw);
    record.results.push({ keyword: kw, asin: CONFIG.asin, rank: r.rank, page: r.page, error: r.error });
    await sleep(1500);
  }

  await browser.close();

  const history = loadHistory();
  history.records.push(record);
  saveHistory(history);

  fs.writeFileSync(RESULT_FILE, JSON.stringify(record, null, 2), 'utf8');
  console.log('\n=== 结果 ===');
  console.log(JSON.stringify(record, null, 2));
}

main().catch((err) => {
  console.error('抓取异常:', err);
  process.exit(1);
});
