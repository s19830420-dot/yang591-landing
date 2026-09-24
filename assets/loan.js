'use strict';

(function initLoanCalculator(global) {
  function round(value) { return Math.round(value); }
  function money(value) { return `NT$ ${round(value).toLocaleString('zh-TW')}`; }
  function normalizeNumeric(value) {
    return String(value).trim()
      .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
      .replace(/．/g, '.').replace(/，/g, ',');
  }
  function parseMoney(value) {
    const normalized = normalizeNumeric(value).replace(/元$/, '').replace(/[\s,]/g, '');
    if (!normalized) return Number.NaN;
    const multiplier = normalized.endsWith('萬') ? 10000 : 1;
    const numeric = multiplier === 10000 ? normalized.slice(0, -1) : normalized;
    if (!/^\d+(?:\.\d+)?$/.test(numeric)) return Number.NaN;
    const amount = Number(numeric) * multiplier;
    return Number.isFinite(amount) && amount >= 0 ? amount : Number.NaN;
  }
  function parseAnnualRate(value) {
    const normalized = normalizeNumeric(value).replace(/[\s,]/g, '').replace(/[％%]$/, '');
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return Number.NaN;
    return Number(normalized);
  }

  function calculateLoan({ principal, annualRate, years, graceYears = 0, method = 'annuity' }) {
    const P = Number(principal);
    const parsedAnnualRate = parseAnnualRate(annualRate);
    if (!Number.isFinite(parsedAnnualRate) || parsedAnnualRate < 0 || parsedAnnualRate > 30) {
      throw new Error('請輸入 0～30 之間的年利率（%）');
    }
    const rate = parsedAnnualRate / 100 / 12;
    const months = Number(years) * 12;
    const graceMonths = Math.min(Number(graceYears) * 12, Math.max(0, months - 1));
    const repaymentMonths = months - graceMonths;
    if (!Number.isFinite(P) || !(P >= 0) || !(months > 0) || !(repaymentMonths > 0) || !(rate >= 0)) throw new Error('請輸入有效的貸款條件');
    const annuityPayment = rate === 0 ? P / repaymentMonths : P * rate * (1 + rate) ** repaymentMonths / ((1 + rate) ** repaymentMonths - 1);
    const averagePrincipal = P / repaymentMonths;
    let balance = P;
    let totalInterest = 0;
    let totalPayment = 0;
    const schedule = [];
    for (let month = 1; month <= months; month += 1) {
      const interest = balance * rate;
      let payment, principalPart;
      if (month <= graceMonths) {
        principalPart = 0;
        payment = interest;
      } else if (method === 'principal') {
        principalPart = Math.min(averagePrincipal, balance);
        payment = principalPart + interest;
      } else {
        payment = annuityPayment;
        principalPart = Math.min(payment - interest, balance);
        payment = principalPart + interest;
      }
      balance = Math.max(0, balance - principalPart);
      totalInterest += interest;
      totalPayment += payment;
      schedule.push({ month, payment, principal: principalPart, interest, balance });
    }
    if (!Number.isFinite(totalPayment)) throw new Error('請輸入 0～30 之間的年利率（%）');
    const firstRepayment = schedule[graceMonths] || schedule[0];
    return {
      principal: P, annualRate: parsedAnnualRate, years: Number(years), graceYears: Number(graceYears), method,
      gracePayment: graceMonths ? P * rate : 0,
      repaymentPayment: firstRepayment.payment,
      totalInterest, totalPayment, schedule, graceMonths
    };
  }

  const api = { calculateLoan, parseMoney, money, round };
  global.HouseYangLoan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('#loan-form');
    if (!form) return;
    const rateInput = document.querySelector('#annual-rate');
    const rateSource = document.querySelector('#loan-rate-source');
    const cityCaption = document.querySelector('#location-caption');
    const cityBody = document.querySelector('#location-rates');
    const youthToggle = document.querySelector('#youth-loan');
    const youthNotice = document.querySelector('#youth-note');
    const youthLimitNotice = document.querySelector('#youth-limit-note');
    const loanMode = document.querySelector('#loan-mode');
    const loanValue = document.querySelector('#loan-value');
    const loanValueLabel = document.querySelector('#loan-value-label');

    function syncLoanLabel() {
      const byRatio = loanMode.value === 'ratio';
      loanValueLabel.textContent = byRatio ? '貸款成數（%）' : '貸款金額（元）';
      loanValue.placeholder = byRatio ? '例如：80' : '例如：8,000,000';
      loanValue.value = byRatio ? '80' : '';
      loanValue.setAttribute('inputmode', 'decimal');
    }
    function renderRates(data) {
      rateInput.value = data.cbc.homeLoanRate.toFixed(3);
      rateSource.textContent = `中央銀行公布 ${data.cbc.year} 年 ${data.cbc.month} 月五大銀行新承做購屋貸款平均利率 ${data.cbc.homeLoanRate.toFixed(3)}%`;
      const [locationYear, locationMonth] = data.locations.period.split('-').map(Number);
      cityCaption.textContent = `聯徵中心 ${locationYear} 年 ${locationMonth} 月各縣市新增房貸平均利率（%，連江縣無資料）`;
      cityBody.replaceChildren(...data.locations.rates.map(item => {
        const row = document.createElement('tr');
        const city = document.createElement('td'); city.textContent = item.name;
        const value = document.createElement('td'); value.textContent = `${item.rate.toFixed(3)}%`;
        row.append(city, value); return row;
      }));
    }
    function renderSchedule(result) {
      const body = document.querySelector('#schedule-body');
      const selected = [];
      for (let index = 0; index < Math.min(12, result.schedule.length); index += 1) selected.push(result.schedule[index]);
      for (let index = 11; index < result.schedule.length; index += 12) {
        if (!selected.includes(result.schedule[index])) selected.push(result.schedule[index]);
      }
      body.replaceChildren(...selected.map(item => {
        const row = document.createElement('tr');
        for (const text of [item.month, round(item.payment).toLocaleString('zh-TW'), round(item.principal).toLocaleString('zh-TW'), round(item.interest).toLocaleString('zh-TW'), round(item.balance).toLocaleString('zh-TW')]) {
          const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
        }
        return row;
      }));
    }
    function renderResult(result, price) {
      document.querySelector('#result-principal').textContent = money(result.principal);
      document.querySelector('#result-grace').textContent = result.graceMonths ? money(result.gracePayment) : '無寬限期';
      const baseLabel = result.method === 'principal' ? '首期本息（之後逐月遞減）' : '每月本息';
      document.querySelector('#result-payment-label').textContent = result.graceMonths ? `寬限期後${baseLabel}` : baseLabel;
      document.querySelector('#result-payment').textContent = money(result.repaymentPayment);
      document.querySelector('#result-interest').textContent = money(result.totalInterest);
      document.querySelector('#result-total').textContent = money(result.totalPayment);
      document.querySelector('#result-downpayment').textContent = money(Math.max(0, price - result.principal));
      renderSchedule(result);
    }
    function clearResult() {
      for (const selector of ['#result-principal', '#result-grace', '#result-payment', '#result-interest', '#result-total', '#result-downpayment']) {
        document.querySelector(selector).textContent = '—';
      }
      document.querySelector('#result-payment-label').textContent = '每月本息';
      document.querySelector('#schedule-body').replaceChildren();
      youthLimitNotice.hidden = true;
    }
    function updateYouthNotices(principal, price) {
      youthNotice.hidden = !youthToggle.checked;
      const ratio = principal / price * 100;
      youthLimitNotice.hidden = !(youthToggle.checked && (principal > 10000000 || ratio > 80));
    }
    function calculate() {
      const price = parseMoney(document.querySelector('#home-price').value);
      const loanInput = parseMoney(loanValue.value);
      const values = new FormData(form);
      try {
        if (!Number.isFinite(price) || price <= 0) throw new Error('請輸入正數房價，可用逗號或「萬」，例如 1,000 萬。');
        if (loanMode.value === 'ratio' && (!Number.isFinite(loanInput) || loanInput < 1 || loanInput > 100)) {
          throw new Error('貸款成數請輸入 1～100 之間的數字，例如 80。');
        }
        if (loanMode.value === 'amount' && (!Number.isFinite(loanInput) || loanInput <= 0)) {
          throw new Error('請輸入正數貸款金額，可用逗號或「萬」，例如 800 萬。');
        }
        const principal = loanMode.value === 'ratio' ? price * loanInput / 100 : loanInput;
        if (principal > price) throw new Error('貸款金額不得高於房價。');
        const result = calculateLoan({ principal, annualRate: rateInput.value, years: values.get('years'), graceYears: values.get('grace'), method: values.get('method') });
        renderResult(result, price);
        updateYouthNotices(principal, price);
      } catch (error) {
        clearResult();
        window.alert(error.message);
      }
    }
    loanMode.addEventListener('change', syncLoanLabel);
    youthToggle.addEventListener('change', calculate);
    form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
    syncLoanLabel();
    fetch('../assets/rates.json').then(response => {
      if (!response.ok) throw new Error('rates.json 載入失敗');
      return response.json();
    }).then(data => { renderRates(data); calculate(); }).catch(() => {
      rateSource.textContent = '利率資料載入失敗，請自行輸入年利率後試算。';
      cityCaption.textContent = '縣市利率資料暫時無法載入。';
      calculate();
    });
  });
}(typeof window !== 'undefined' ? window : globalThis));
