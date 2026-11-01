/**
 * 排名诊断 + 飞书通知脚本（云端版）
 * 飞书 Webhook 从环境变量 FEISHU_WEBHOOK 读取（GitHub Secrets 注入）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const WEBHOOK = process.env.FEISHU_WEBHOOK;
const ASIN = 'B0H1X8PBZX';
const MARKETPLACE = 'www.amazon.com';

const RESULT_FILE = path.join(__dirname, 'last_result.json');
const HISTORY_FILE = path.join(__dirname, 'rank_history.json');

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function diagnose(result, history) {
  const records = history.records || [];
  const prev = records.length >= 2 ? records[records.length - 2] : null;
  const diagnostics = [];

  for (const r of result.results) {
    let prevRank = null;
    if (prev) {
      const prevR = (prev.results || []).find((x) => x.keyword === r.keyword);
      if (prevR) prevRank = prevR.rank;
    }

    const diag = { keyword: r.keyword, currRank: r.rank, prevRank, change: null, status: '', reason: '' };

    if (r.error) {
      diag.status = '抓取异常';
      diag.reason = r.error;
    } else if (r.rank === null || r.rank === undefined) {
      diag.status = '未进入前5页';
      diag.reason = '目标ASIN在前5页内未出现，自然排名跌出监控范围（约>240位）';
    } else if (prevRank === null || prevRank === undefined) {
      diag.status = '首次记录';
      diag.reason = '首次抓取，暂无历史对比';
    } else {
      const change = prevRank - r.rank;
      diag.change = change;
      if (change > 0) {
        diag.status = '排名上升';
        diag.reason = `较上次上升 ${change} 位`;
      } else if (change < 0) {
        diag.status = '排名下降';
        diag.reason = `较上次下降 ${Math.abs(change)} 位`;
        diag.diagnosis = diagnoseDrop(r.keyword, prevRank, r.rank);
      } else {
        diag.status = '排名持平';
        diag.reason = '与上次一致';
      }
    }
    diagnostics.push(diag);
  }
  return diagnostics;
}

function diagnoseDrop(keyword, prevRank, currRank) {
  const drop = prevRank - currRank;
  const reasons = [];
  if (drop >= 100) {
    reasons.push('排名大幅下跌（≥100位），可能自然权重骤降、类目节点被改、或触发算法惩罚');
  } else if (drop >= 30) {
    reasons.push('排名明显下滑，需关注转化率、差评、退货或断货');
  }
  if (prevRank <= 48 && currRank > 48) {
    reasons.push('已跌出搜索结果第1页，自然流量将显著受损');
  }
  reasons.push('可能原因：①新增差评/评分下降 ②转化率下滑 ③库存不足或断货 ④竞品加大广告投放 ⑤价格/优惠调整 ⑥listing关键词相关性变化');
  return reasons.join('；');
}

function sendFeishu(text) {
  return new Promise((resolve, reject) => {
    if (!WEBHOOK) {
      reject(new Error('未配置 FEISHU_WEBHOOK 环境变量'));
      return;
    }
    const payload = JSON.stringify({ msg_type: 'text', content: { text } });
    const url = new URL(WEBHOOK);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.code === 0 || j.StatusCode === 0 || j.msg === 'success') resolve(true);
          else reject(new Error('飞书返回异常: ' + data));
        } catch (e) {
          resolve(true);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function formatMessage(result, diagnostics) {
  const time = new Date(result.timestamp);
  const timeStr = time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const lines = [
    `【亚马逊排名监控】${timeStr}`,
    `ASIN: ${ASIN} | 站点: ${MARKETPLACE}`,
    '',
  ];
  for (const d of diagnostics) {
    const rankStr = d.currRank ? `#${d.currRank}` : '未上榜';
    lines.push(`🔑 ${d.keyword}`);
    lines.push(`   排名: ${rankStr}  |  ${d.status}`);
    if (d.change !== null && d.change !== undefined) {
      lines.push(`   变化: ${d.change > 0 ? '↑' : '↓'}${Math.abs(d.change)}位`);
    }
    if (d.reason) lines.push(`   说明: ${d.reason}`);
    if (d.diagnosis) lines.push(`   诊断: ${d.diagnosis}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const result = readJson(RESULT_FILE);
  if (!result) {
    console.error('未找到 last_result.json');
    process.exit(1);
  }
  const history = readJson(HISTORY_FILE) || { records: [] };
  const diagnostics = diagnose(result, history);
  const message = formatMessage(result, diagnostics);
  console.log(message);

  try {
    await sendFeishu(message);
    console.log('\n✅ 飞书通知已发送');
  } catch (e) {
    console.error('❌ 飞书通知失败:', e.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('诊断脚本异常:', err);
  process.exit(1);
});
