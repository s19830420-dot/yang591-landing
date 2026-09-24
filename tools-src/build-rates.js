'use strict';

const fs = require('fs');
const path = require('path');

const sourceDir = 'D:/HouseYang/kb-build/k13-sources';
const cbcFile = path.join(sourceDir, 'rate_cbc_5bank.csv');
const jcicFile = path.join(sourceDir, 'rate_jcic_location.csv');
const outputFile = path.resolve(__dirname, '..', 'assets', 'rates.json');
const cityOrder = ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市', '基隆市', '宜蘭縣', '嘉義市', '新竹縣', '苗栗縣', '南投縣', '彰化縣', '新竹市', '雲林縣', '嘉義縣', '屏東縣', '花蓮縣', '台東縣', '金門縣', '澎湖縣'];

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some(value => value !== '')) rows.push(row);
  const [header, ...data] = rows;
  return data.map(values => Object.fromEntries(header.map((key, index) => [key.replace(/^\uFEFF/, ''), values[index] ?? ''])));
}

function parseCbcPeriod(value) {
  const match = /^(\d{4})M(\d{2})$/.exec(value);
  if (!match) throw new Error(`無法辨識五大銀行期間：${value}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function numeric(value, label) {
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number)) throw new Error(`無法辨識數字 ${label}：${value}`);
  return number;
}

function buildRates() {
  for (const file of [cbcFile, jcicFile]) {
    if (!fs.existsSync(file)) throw new Error(`找不到指定官方來源：${file}`);
  }
  const cbcRows = parseCsv(fs.readFileSync(cbcFile, 'utf8'));
  const jcicRows = parseCsv(fs.readFileSync(jcicFile, 'utf8'));
  const latestCbc = cbcRows.reduce((latest, row) => {
    const period = parseCbcPeriod(row['期間']);
    return !latest || period.year * 100 + period.month > latest.year * 100 + latest.month
      ? { ...period, rate: numeric(row['購屋貸款-利率'], '五大銀行購屋貸款利率') }
      : latest;
  }, null);
  const latestJcicKey = Math.max(...jcicRows.map(row => Number(row['年']) * 100 + Number(row['月'])));
  const latestJcicRows = jcicRows.filter(row => Number(row['年']) * 100 + Number(row['月']) === latestJcicKey);
  const locations = cityOrder.map(name => {
    const row = latestJcicRows.find(item => String(item['擔保品所在縣市別']).replace(/^[A-Z]/, '') === name);
    if (!row) throw new Error(`聯徵中心最新月份缺少縣市：${name}`);
    return { name, rate: Number(numeric(row['平均利率[%]'], `${name} 平均利率`).toFixed(3)) };
  });
  const output = {
    generatedAt: '2026-09-24',
    cbc: {
      period: `${latestCbc.year}M${String(latestCbc.month).padStart(2, '0')}`,
      year: latestCbc.year,
      month: latestCbc.month,
      homeLoanRate: Number(latestCbc.rate.toFixed(3)),
      source: '中央銀行五大銀行新承做放款金額與利率'
    },
    locations: {
      period: `${Math.floor(latestJcicKey / 100)}-${String(latestJcicKey % 100).padStart(2, '0')}`,
      source: '財團法人金融聯合徵信中心房貸擔保品所在縣市別新增授信金額及利率',
      rates: locations
    }
  };
  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

if (require.main === module) {
  const rates = buildRates();
  console.log(`已產生 ${path.relative(process.cwd(), outputFile)}：${rates.cbc.period}、${rates.locations.period}`);
}

module.exports = { buildRates, parseCsv };
