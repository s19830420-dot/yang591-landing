'use strict';

(function initLoanCalculator(global) {
  function round(value) { return Math.round(value); }
  function money(value) { return `NT$ ${round(value).toLocaleString('zh-TW')}`; }
  function parseMoney(value) { return Number(String(value).replace(/[^0-9.]/g, '')) || 0; }

  function calculateLoan({ principal, annualRate, years, graceYears = 0, method = 'annuity' }) {
    const P = Number(principal);
    const rate = Number(annualRate) / 100 / 12;
    const months = Number(years) * 12;
    const graceMonths = Math.min(Number(graceYears) * 12, Math.max(0, months - 1));
    const repaymentMonths = months - graceMonths;
    if (!(P >= 0) || !(months > 0) || !(repaymentMonths > 0) || !(rate >= 0)) throw new Error('請輸入有效的貸款條件');
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
    const firstRepayment = schedule[graceMonths] || schedule[0];
    return {
      principal: P, annualRate: Number(annualRate), years: Number(years), graceYears: Number(graceYears), method,
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
    const loanMode = document.querySelector('#loan-mode');
    const loanValue = document.querySelector('#loan-value');
    const loanValueLabel = document.querySelector('#loan-value-label');
    let latestRate = null;

    function syncLoanLabel() {
      const byRatio = loanMode.value === 'ratio';
      loanValueLabel.textContent = byRatio ? '貸款成數（%）' : '貸款金額（元）';
      loanValue.placeholder = byRatio ? '例如：80' : '例如：8,000,000';
      loanValue.value = byRatio ? '80' : '';
      loanValue.setAttribute('inputmode', 'decimal');
    }
    function renderRates(data) {
      latestRate = data.cbc.homeLoanRate;
      rateInput.value = latestRate.toFixed(3);
      rateSource.textContent = `中央銀行公布 ${data.cbc.year} 年 ${data.cbc.month} 月新承做購屋貸款平均利率 ${latestRate.toFixed(3)}%`;
      cityCaption.textContent = `聯徵中心 ${data.locations.period.replace('-', ' 年 ')} 月各縣市新增房貸平均利率（%）`;
      cityBody.replaceChildren(...data.locations.rates.map(item => {
        const row = document.createElement('tr');
        const city = document.createElement('td'); city.textContent = item.name;
        const value = document.createElement('td'); value.textContent = `${item.rate.toFixed(3)}%`;
        row.append(city, value); return row;
      }));
    }
    function loanPrincipal() {
      const price = parseMoney(document.querySelector('#home-price').value);
      const value = parseMoney(loanValue.value);
      return loanMode.value === 'ratio' ? price * value / 100 : value;
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
        for (const text of [item.month, money(item.payment), money(item.principal), money(item.interest), money(item.balance)]) {
          const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
        }
        return row;
      }));
    }
    function renderResult(result, price) {
      document.querySelector('#result-principal').textContent = money(result.principal);
      document.querySelector('#result-grace').textContent = result.graceMonths ? money(result.gracePayment) : '無寬限期';
      document.querySelector('#result-payment').textContent = money(result.repaymentPayment);
      document.querySelector('#result-interest').textContent = money(result.totalInterest);
      document.querySelector('#result-total').textContent = money(result.totalPayment);
      document.querySelector('#result-downpayment').textContent = money(Math.max(0, price - result.principal));
      renderSchedule(result);
    }
    function calculate() {
      const price = parseMoney(document.querySelector('#home-price').value);
      const principal = loanPrincipal();
      const values = new FormData(form);
      try {
        if (!price || !principal || principal > price) throw new Error('請確認房價與貸款金額；貸款金額不得高於房價。');
        const result = calculateLoan({ principal, annualRate: rateInput.value, years: values.get('years'), graceYears: values.get('grace'), method: values.get('method') });
        renderResult(result, price);
        const youthNotice = document.querySelector('#youth-note');
        youthNotice.hidden = !youthToggle.checked;
      } catch (error) { window.alert(error.message); }
    }
    loanMode.addEventListener('change', syncLoanLabel);
    youthToggle.addEventListener('change', () => { document.querySelector('#youth-note').hidden = !youthToggle.checked; });
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
