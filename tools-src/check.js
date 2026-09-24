'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const sourceRules = 'D:/HouseYang/kb-build/k13-sources/contract-rules.json';
const youthLoanSource = 'D:/HouseYang/kb-build/k13-sources/youth_loan_rules.html';
const pages = [
  'guide/index.html',
  'guide/before-signing.html',
  'guide/contract.html',
  'guide/tax-and-registration.html',
  'guide/handover.html',
  'guide/presale.html',
  'tools/loan.html'
];
const articles = pages.slice(1, 6);
const forbiddenInternalPhrases = [
  '本頁來源未提供',
  '本頁指定的官方條文來源',
  '本頁不把個案文件',
  '不把期限、金額或效力寫成通則'
];
const legalOriginalPhrases = [
  ['guide/tax-and-registration.html', '不動產買賣契約按契約金額千分之一計'],
  ['guide/tax-and-registration.html', '買賣契稅稅率為 6%；實際課稅基礎與核定金額'],
  ['guide/presale.html', '本頁來源未提供紅單的個案文件內容'],
  ['guide/before-signing.html', '本頁指定的官方條文來源沒有列出所有斡旋或要約書的個案條件'],
  ['guide/before-signing.html', '不動產說明書應記載及不得記載事項（不得記載事項）第5點（內政部主管法規共用系統；台內地字第1140267470號 令）'],
  ['guide/tax-and-registration.html', '代辦、公證與抵押權登記相關費用，也要看勾選的負擔方式'],
  ['guide/contract.html', '或由賣方在約定期限前清償並塗銷。'],
  ['guide/handover.html', '交屋後不得約定排除賣方的民法上瑕疵擔保責任。'],
  ['guide/handover.html', '整理固定設備、點交日、找補、水電瓦斯、管理費與文件移交的官方契約重點。'],
  ['guide/presale.html', '預售屋買賣定型化契約應記載及不得記載事項（應記載事項）第7點（內政部主管法規共用系統；台內地字第1120263817號 公告）'],
  ['guide/presale.html', '結構部分保固十五年，固定建材及設備部分保固一年。'],
  ['guide/presale.html', '或其他公告且經地方主管機關核准的情形，依條款例外處理。'],
  ['guide/tax-and-registration.html', '整理成屋契稅、印花稅、土增稅、登記規費與交屋日前後的費用分界。']
];
let failures = 0;

function fail(message) { failures += 1; console.error(`✗ ${message}`); }
function pass(message) { console.log(`✓ ${message}`); }
function expect(condition, message) { if (condition) pass(message); else fail(message); }
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function attribute(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match ? match[2] : null;
}
function textWithoutScripts(html) { return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''); }
function textWithoutTags(html) { return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ''); }
function external(url) { return /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(url); }
function validateHtml(relative) {
  const html = read(relative);
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() || '';
  const descriptionTag = [...html.matchAll(/<meta\b[^>]*>/gi)].find(tag => attribute(tag[0], 'name')?.toLowerCase() === 'description');
  const description = descriptionTag ? attribute(descriptionTag[0], 'content') || '' : '';
  const canonical = /<link\b[^>]*\brel=(["'])canonical\1[^>]*>/i.exec(html)?.[0] || '';
  const canonicalHref = canonical ? attribute(canonical, 'href') : '';
  const expectedCanonical = `https://houseyang.tw/${relative}`;
  const opens = (html.match(/<div\b[^>]*>/gi) || []).length;
  const closes = (html.match(/<\/div\s*>/gi) || []).length;
  expect(/^<!doctype html>/i.test(html) && /<html\b/i.test(html) && /<\/html>\s*$/i.test(html), `${relative} 可解析為完整 HTML`);
  expect(opens === closes, `${relative} DIV 標籤平衡`);
  expect(Boolean(title) && title.length <= 32, `${relative} title 存在且不超過 32 字`);
  expect(Boolean(description) && description.length <= 80, `${relative} description 存在且不超過 80 字`);
  expect(canonicalHref === expectedCanonical, `${relative} canonical 正確`);
  const jsonBlocks = [...html.matchAll(/<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)];
  const parsed = [];
  for (const block of jsonBlocks) {
    try { parsed.push(JSON.parse(block[2])); }
    catch (error) { fail(`${relative} JSON-LD 無法 JSON.parse：${error.message}`); }
  }
  expect(parsed.length === jsonBlocks.length && parsed.length >= 2, `${relative} JSON-LD 可解析`);
  const faq = parsed.find(item => item['@type'] === 'FAQPage');
  const visibleText = textWithoutScripts(html);
  const questions = faq?.mainEntity || [];
  expect(questions.length >= 3 && questions.every(item => visibleText.includes(item.name)), `${relative} FAQ 題目出現在內文`);
  expect(!/app\.houseyang\.tw/i.test(html), `${relative} 沒有 app.houseyang.tw`);
  expect(!/(我自己在用|零風險|保證獲利)/.test(html), `${relative} 沒有禁用字`);
  for (const match of html.matchAll(/\bhref=(["'])(.*?)\1/gi)) {
    const href = match[2];
    if (!href || href.startsWith('#') || external(href)) continue;
    const target = path.resolve(path.dirname(path.join(root, relative)), href.split(/[?#]/)[0]);
    expect(target.startsWith(root) && fs.existsSync(target), `${relative} 內部連結存在：${href}`);
  }
  return html;
}

function checkCitations() {
  const citations = new Set(JSON.parse(fs.readFileSync(sourceRules, 'utf8')).map(rule => rule.cite_text));
  for (const relative of articles) {
    const html = read(relative);
    const cited = [...citations].filter(citation => html.includes(citation));
    expect(cited.length >= 5, `${relative} 至少有 5 個可驗證的官方 cite_text 出處（${cited.length}）`);
  }
}

function checkEditorialGuards() {
  for (const relative of pages) {
    const html = read(relative);
    for (const phrase of forbiddenInternalPhrases) {
      expect(!html.includes(phrase), `${relative} 沒有內部作業用語：${phrase}`);
    }
  }
  for (const [relative, phrase] of legalOriginalPhrases) {
    expect(!read(relative).includes(phrase), `${relative} 已移除 legal 段原 Q：${phrase}`);
  }
}

function checkYouthLoanFacts() {
  const sourceText = textWithoutTags(fs.readFileSync(youthLoanSource, 'utf8'));
  const loanPage = read('tools/loan.html');
  const facts = [
    ['最高 8 成', '最高8成'],
    ['1,000 萬元', '1,000萬元'],
    ['申請日前 2 年內完成結婚登記', '申請日前2年內完成結婚登記'],
    ['1,200 萬元', '1,200萬元'],
    ['1,500 萬元', '1,500萬元'],
    ['40 年', '40年'],
    ['5 年', '5年'],
    ['80 歲', '80']
  ];
  for (const [pageFact, sourceFact] of facts) {
    expect(loanPage.includes(pageFact) && sourceText.includes(sourceFact), `青安數字「${pageFact}」可在國庫署原文找到`);
  }
  const faq = [...loanPage.matchAll(/<script\b[^>]*type=(['"])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => JSON.parse(match[2]))
    .find(item => item['@type'] === 'FAQPage');
  const youthAnswer = faq.mainEntity.find(item => item.name === '青安貸款額度與年限是多少？').acceptedAnswer.text;
  const faqFacts = ['1,000 萬元', '1,200 萬元', '1,500 萬元', '40 年', '5 年'];
  expect(faqFacts.every(fact => youthAnswer.includes(fact)), '青安 FAQ 的額度與年限數字均來自國庫署原文');
}

function checkLoanMath() {
  const loan = require(path.join(root, 'assets', 'loan.js'));
  function throws(action) { try { action(); return false; } catch { return true; } }
  const normal = loan.calculateLoan({ principal: 10000000, annualRate: 2.1, years: 30, graceYears: 0, method: 'annuity' });
  expect(Math.abs(Math.round(normal.repaymentPayment) - 37464) <= 1, '本息平均 10,000,000／2.1%／30 年為每月 37,464（±1）');
  const grace = loan.calculateLoan({ principal: 10000000, annualRate: 2.1, years: 30, graceYears: 3, method: 'annuity' });
  expect(Math.round(grace.gracePayment) === 17500 && Math.abs(Math.round(grace.repaymentPayment) - 40463) <= 1, '3 年寬限期為每月付息 17,500，期滿後 40,463（±1）');
  const principal = loan.calculateLoan({ principal: 10000000, annualRate: 2.1, years: 30, graceYears: 0, method: 'principal' });
  expect(Math.round(principal.schedule[0].payment) === 45278, '本金平均第 1 期為 27,778＋17,500＝45,278');
  const zero = loan.calculateLoan({ principal: 10000000, annualRate: 0, years: 30, graceYears: 0, method: 'annuity' });
  expect(Math.round(zero.repaymentPayment) === 27778, '利率 0 時使用 P/n');
  expect(throws(() => loan.calculateLoan({ principal: 10000000, annualRate: '', years: 30 })), '空白年利率不會以 0% 試算');
  expect(throws(() => loan.calculateLoan({ principal: 10000000, annualRate: 31, years: 30 })), '年利率超過 30% 會被拒絕');
  expect(loan.parseMoney('1,000 萬') === 10000000 && loan.parseMoney('８０') === 80, '金額可解析「萬」與全形數字');
  expect(['-80', '1e7', '一千萬', ''].every(value => Number.isNaN(loan.parseMoney(value))), '無效或負數金額不會靜默變成其他數字');
}

function checkSitemapAndIndex() {
  const sitemap = read('sitemap.xml');
  const urls = pages.map(relative => `https://houseyang.tw/${relative}`);
  expect(/^<\?xml\b/.test(sitemap) && /<urlset\b/.test(sitemap) && /<\/urlset>\s*$/.test(sitemap), 'sitemap.xml 結構完整');
  expect(urls.every(url => sitemap.includes(`<loc>${url}</loc>`) && sitemap.includes('<lastmod>2026-09-24</lastmod>')), 'sitemap.xml 含 7 個新網址與 2026-09-24 lastmod');
  const index = read('index.html');
  expect((index.match(/href="guide\/index\.html"/g) || []).length === 2, 'index.html 僅新增兩個買賣流程入口');
  expect((index.match(/href="tools\/loan\.html"/g) || []).length === 2, 'index.html 僅新增兩個房貸試算入口');
  const diff = childProcess.spawnSync('git', ['diff', '--unified=0', '--', 'index.html'], { cwd: root, encoding: 'utf8' }).stdout;
  const removed = diff.split(/\r?\n/).filter(line => line.startsWith('-') && !line.startsWith('---'));
  const previousButtonGroup = '<div class="lt-btns"><a class="btn-secondary" href="guide/index.html">查看買賣流程 →</a><a class="btn-secondary" href="tools/loan.html">房貸試算 →</a><a class="btn-secondary" href="https://law.houseyang.tw/" target="_blank" rel="noopener">打開房產法律速查 →</a></div>';
  const expectedButtonGroup = '<div class="lt-btns"><a class="btn-secondary" href="https://law.houseyang.tw/" target="_blank" rel="noopener">打開房產法律速查 →</a><a class="btn-secondary" href="guide/index.html">買賣流程指南 →</a><a class="btn-secondary" href="tools/loan.html">房貸試算 →</a></div>';
  expect(index.includes(expectedButtonGroup), 'index.html 免費工具按鈕先放法律速查，再放新增入口');
  expect(index.includes('@media(max-width:900px){.nav-link[href^="https://vasthub"],.nav-link[href^="https://nextspot"]{display:none}}'), 'index.html 641～900px 隱藏外站導覽連結');
  expect(removed.every(line => line.slice(1).trim() === previousButtonGroup), 'index.html 僅調整既有免費工具按鈕群的排序與文案');
}

function checkRates() {
  const rates = JSON.parse(read('assets/rates.json'));
  expect(rates.cbc?.period === '2026M07' && rates.cbc.homeLoanRate === 2.29, 'rates.json 使用最新五大銀行 2026M07 購屋貸款利率');
  expect(rates.locations?.period === '2026-06' && rates.locations.rates.length === 21, 'rates.json 使用最新聯徵中心 2026-06 的 21 筆縣市資料');
}

function checkResponsiveRules() {
  const guideCss = read('assets/guide.css');
  expect(guideCss.includes('.prose{width:min(720px,calc(100% - 32px));margin:auto}'), '指南頁 .prose 在手機保留左右各 16px');
  expect(/body\{[^}]*overflow-x:hidden/.test(guideCss), '指南頁 body 有水平溢位防護');
  const index = read('index.html');
  expect(index.includes('@media(min-width:641px) and (max-width:700px){.logo-tag{display:none}.nav-right{gap:6px 12px}}'), '首頁 641～700px 會縮減 logo 標籤與導覽間距');
}

for (const page of pages) validateHtml(page);
checkCitations();
checkEditorialGuards();
checkYouthLoanFacts();
checkLoanMath();
checkRates();
checkResponsiveRules();
checkSitemapAndIndex();
console.log('\n--- git diff --stat ---');
console.log(childProcess.spawnSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).stdout.trim());
if (failures) { console.error(`\n驗證失敗：${failures} 項`); process.exitCode = 1; }
else console.log('\n全部驗證通過。');
