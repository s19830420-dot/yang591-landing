'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const sourceRules = 'D:/HouseYang/kb-build/k13-sources/contract-rules.json';
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

function checkLoanMath() {
  const loan = require(path.join(root, 'assets', 'loan.js'));
  const normal = loan.calculateLoan({ principal: 10000000, annualRate: 2.1, years: 30, graceYears: 0, method: 'annuity' });
  expect(Math.abs(Math.round(normal.repaymentPayment) - 37464) <= 1, '本息平均 10,000,000／2.1%／30 年為每月 37,464（±1）');
  const grace = loan.calculateLoan({ principal: 10000000, annualRate: 2.1, years: 30, graceYears: 3, method: 'annuity' });
  expect(Math.round(grace.gracePayment) === 17500 && Math.abs(Math.round(grace.repaymentPayment) - 40463) <= 1, '3 年寬限期為每月付息 17,500，期滿後 40,463（±1）');
  const principal = loan.calculateLoan({ principal: 10000000, annualRate: 2.1, years: 30, graceYears: 0, method: 'principal' });
  expect(Math.round(principal.schedule[0].payment) === 45278, '本金平均第 1 期為 27,778＋17,500＝45,278');
  const zero = loan.calculateLoan({ principal: 10000000, annualRate: 0, years: 30, graceYears: 0, method: 'annuity' });
  expect(Math.round(zero.repaymentPayment) === 27778, '利率 0 時使用 P/n');
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
  const permittedReplacement = '<div class="lt-btns"><a class="btn-secondary" href="https://law.houseyang.tw/" target="_blank" rel="noopener">打開房產法律速查 →</a></div>';
  expect(removed.every(line => line.slice(1).trim() === permittedReplacement), 'index.html 僅在既有免費工具按鈕群新增連結，未改其他內容');
}

function checkRates() {
  const rates = JSON.parse(read('assets/rates.json'));
  expect(rates.cbc?.period === '2026M07' && rates.cbc.homeLoanRate === 2.29, 'rates.json 使用最新五大銀行 2026M07 購屋貸款利率');
  expect(rates.locations?.period === '2026-06' && rates.locations.rates.length === 9, 'rates.json 使用最新聯徵中心 2026-06 六都、基隆與新竹資料');
}

for (const page of pages) validateHtml(page);
checkCitations();
checkLoanMath();
checkRates();
checkSitemapAndIndex();
console.log('\n--- git diff --stat ---');
console.log(childProcess.spawnSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).stdout.trim());
if (failures) { console.error(`\n驗證失敗：${failures} 項`); process.exitCode = 1; }
else console.log('\n全部驗證通過。');
