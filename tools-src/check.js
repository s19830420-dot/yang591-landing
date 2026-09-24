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
  '不把期限、金額或效力寫成通則',
  '本頁僅說明',
  '不以個案資料',
  '依原文',
  '不接分析',
  '不接表單',
  '別把個案條件當通則'
];
const legalOriginalPhrases = [
  ['guide/tax-and-registration.html', '不動產買賣契約按契約金額千分之一計'],
  ['guide/tax-and-registration.html', '買賣契稅稅率為 6%；實際課稅基礎與核定金額'],
  ['guide/presale.html', '本頁來源未提供紅單的個案文件內容'],
  ['guide/before-signing.html', '本頁指定的官方條文來源沒有列出所有斡旋或要約書的個案條件'],
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
  const youthText = textWithoutTags(/<section class="youth">([\s\S]*?)<\/section>/.exec(loanPage)?.[1] || '');
  const facts = [
    ['貸款成數最高8成', '貸款成數：最高8成核貸'],
    ['一般貸款額度最高1,000萬元', '貸款額度：最高1,000萬元'],
    ['申請日前2年內完成結婚登記的新婚家庭最高1,200萬元', '申請日前2年內完成結婚登記之家庭（下稱新婚家庭），最高1,200萬元'],
    ['育有未成年子女家庭最高1,500萬元', '育有未成年子女家庭，最高1,500萬元'],
    ['貸款年限最長40年、含寬限期最長5年', '貸款年限最長40年，含寬限期5年'],
    ['借款人申貸年齡加計核貸年限不得超過80歲', '借款人申貸年齡加計核貸年限，合計不得逾80'],
    ['申請資格：借款人申貸時未滿50歲，本人與配偶及未成年子女均無自有住宅，本人年所得總額不超過200萬元。', '申貸時未滿50歲，且借款人與其配偶及未成年子女均無自有住宅者。'],
    ['購買住宅的鑑價或買賣總價（兩者取較高者）不得超過：臺北市3,500萬元；新北市及新竹縣（市）2,500萬元；其他縣（市）2,000萬元。', '購買住宅鑑價或買賣總價（二者取孰高），不得逾下列金額：１、臺北市3,500萬元。２、新北市及新竹縣（市）2,500萬元。３、其他縣（市）2,000萬元。'],
    ['貸款標的須是申請日前6個月內因買賣取得所有權的住宅；申辦期限到118年7月31日。', '貸款標的：申請日前6個月內因買賣取得所有權之住宅。'],
    ['貸款標的須是申請日前6個月內因買賣取得所有權的住宅；申辦期限到118年7月31日。', '本優惠貸款申辦日期至118年7月31日止。']
  ];
  for (const [pageFact, sourceFact] of facts) {
    expect(youthText.includes(pageFact) && sourceText.includes(sourceFact), `青安完整敘述「${pageFact}」可在國庫署原文找到`);
  }
  const faq = [...loanPage.matchAll(/<script\b[^>]*type=(['"])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => JSON.parse(match[2]))
    .find(item => item['@type'] === 'FAQPage');
  const youthAnswer = faq.mainEntity.find(item => item.name === '青安貸款額度與年限是多少？').acceptedAnswer.text;
  const faqFact = '一般最高1,000萬元，申請日前2年內完成結婚登記的新婚家庭最高1,200萬元，育有未成年子女家庭最高1,500萬元；貸款年限最長40年，含寬限期最長5年。';
  expect(textWithoutTags(youthAnswer).includes(faqFact) && sourceText.includes('貸款額度：最高1,000萬元；申請日前2年內完成結婚登記之家庭（下稱新婚家庭），最高1,200萬元；育有未成年子女家庭，最高1,500萬元。') && sourceText.includes('貸款年限最長40年，含寬限期5年'), '青安 FAQ 的完整額度與年限敘述均來自國庫署原文');
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
  expect(loan.parseMoney('1,000 萬') === 10000000 && loan.parseMoney('８０') === 80 && loan.parseMoney('1000萬元') === 10000000 && loan.parseMoney('10,000,000元') === 10000000, '金額可解析「萬」、全形數字與結尾「元」');
  expect(loan.calculateLoan({ principal: 10000000, annualRate: '２．２９％', years: 30 }).annualRate === 2.29, '年利率可解析全形數字、小數點與百分比符號');
  expect(['-80', '1e7', '一千萬', ''].every(value => Number.isNaN(loan.parseMoney(value))), '無效或負數金額不會靜默變成其他數字');
}

function checkSitemapAndIndex() {
  const sitemap = read('sitemap.xml');
  const urls = pages.map(relative => `https://houseyang.tw/${relative}`);
  expect(/^<\?xml\b/.test(sitemap) && /<urlset\b/.test(sitemap) && /<\/urlset>\s*$/.test(sitemap), 'sitemap.xml 結構完整');
  expect(urls.every(url => sitemap.includes(`<loc>${url}</loc>`) && sitemap.includes('<lastmod>2026-09-24</lastmod>')) && /<loc>https:\/\/houseyang\.tw\/<\/loc>\s*<lastmod>2026-09-24<\/lastmod>/.test(sitemap), 'sitemap.xml 含首頁、7 個新網址與 2026-09-24 lastmod');
  const index = read('index.html');
  expect((index.match(/href="guide\/index\.html"/g) || []).length === 3, 'index.html 含導覽、工具區與頁尾的買賣流程入口');
  expect((index.match(/href="tools\/loan\.html"/g) || []).length === 3, 'index.html 含導覽、工具區與頁尾的房貸試算入口');
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
  const expectedOrder = ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣'];
  expect(JSON.stringify(rates.locations.rates.map(item => item.name)) === JSON.stringify(expectedOrder), '縣市利率依北到南地理順序排列，並標示連江縣無資料');
}

function checkResponsiveRules() {
  const guideCss = read('assets/guide.css');
  expect(guideCss.includes('.prose{width:min(720px,calc(100% - 32px));margin:auto}'), '指南頁 .prose 在手機保留左右各 16px');
  expect(/body\{[^}]*overflow-x:hidden/.test(guideCss), '指南頁 body 有水平溢位防護');
  expect(guideCss.includes('@media(max-width:420px){nav{gap:10px}.brand{gap:0}.brand strong{display:none}.nav-links{gap:10px;overflow:visible}.nav-links a{padding:11px 0}') && guideCss.includes('.brand span{display:none}'), '375px／320px 導覽隱藏品牌文字、保留完整連結與至少 40px 點擊區');
  expect(guideCss.includes('footer a,.breadcrumb a{display:inline-flex;align-items:center;min-height:44px}.faq summary{padding:9px 0}.cite{padding:10px 0'), '頁尾、麵包屑、FAQ 與出處連結具至少 40px 觸控區');
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
