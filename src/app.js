import {
  DEFAULT_SETTINGS,
  createSampleTrades,
  dailyPerformance,
  enrichTrade,
  groupPerformance,
  number,
  parseCsv,
  summarizeTrades,
  tradesToCsv
} from "./core.js";

const STORE_KEY = "tradecompound.v1";
const pageTitles = {
  overview: "Trading overview",
  trades: "Trade log",
  calendar: "P&L calendar",
  review: "Daily review",
  settings: "Journal settings"
};
const numericTradeFields = ["strike", "entryPrice", "exitPrice", "lots", "lotSize", "executedOrders", "stopLoss", "target", "plannedRisk"];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date - offset).toISOString().slice(0, 10);
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    return {
      version: 1,
      trades: Array.isArray(stored?.trades) ? stored.trades : [],
      reviews: Array.isArray(stored?.reviews) ? stored.reviews : [],
      settings: { ...DEFAULT_SETTINGS, ...(stored?.settings || {}) }
    };
  } catch {
    return { version: 1, trades: [], reviews: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

let state = loadState();
let overviewPeriod = "30";
let calendarCursor = new Date();
calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function currency(value, compact = false) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: compact ? 0 : 2,
    notation: compact && Math.abs(number(value)) >= 100000 ? "compact" : "standard"
  }).format(number(value));
}

function percent(value) {
  return `${number(value).toFixed(1)}%`;
}

function prettyDate(value, short = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", short
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "short", year: "numeric" }
  ).format(new Date(`${value}T00:00:00`));
}

function pnlClass(value) {
  return number(value) > 0 ? "positive" : number(value) < 0 ? "negative" : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme || "dark";
  document.querySelector('meta[name="theme-color"]').content = state.settings.theme === "light" ? "#f3f6f4" : "#07130f";
}

function navigate(view, updateHash = true) {
  const target = pageTitles[view] ? view : "overview";
  $$(".view").forEach(element => element.classList.toggle("active", element.id === `view-${target}`));
  $$(".nav-item").forEach(element => element.classList.toggle("active", element.dataset.view === target));
  $("#page-title").textContent = pageTitles[target];
  $("#sidebar").classList.remove("open");
  if (updateHash) history.replaceState(null, "", `#${target}`);
  if (target === "calendar") renderCalendar();
  if (target === "review") loadReview(localDateFromInput($("#review-date").value));
}

function localDateFromInput(value) {
  return value || localDate();
}

function filterOverviewTrades() {
  if (overviewPeriod === "all") return state.trades;
  const today = new Date(`${localDate()}T00:00:00`);
  if (overviewPeriod === "month") {
    const prefix = localDate().slice(0, 7);
    return state.trades.filter(trade => String(trade.date).startsWith(prefix));
  }
  const from = new Date(today);
  from.setDate(from.getDate() - number(overviewPeriod, 30) + 1);
  return state.trades.filter(trade => new Date(`${trade.date}T00:00:00`) >= from && new Date(`${trade.date}T00:00:00`) <= today);
}

function renderRisk() {
  const todayTrades = state.trades.filter(trade => trade.date === localDate());
  const summary = summarizeTrades(todayTrades, state.settings);
  const lossUsed = Math.max(0, -summary.netPnl);
  const limit = number(state.settings.dailyLossLimit);
  const usage = limit > 0 ? Math.min(100, lossUsed / limit * 100) : 0;
  $("#risk-used").textContent = currency(lossUsed, true);
  $("#risk-progress").style.width = `${usage}%`;
  $("#risk-progress").style.background = usage >= 100 ? "var(--negative)" : usage >= 70 ? "var(--warning)" : "var(--accent)";
  if (!todayTrades.length) $("#risk-message").textContent = "No trades recorded today.";
  else if (usage >= 100) $("#risk-message").textContent = "Daily loss limit reached. Protect tomorrow's capital.";
  else $("#risk-message").textContent = `${currency(Math.max(0, limit - lossUsed), true)} remains before your daily stop.`;
}

function renderOverview() {
  const trades = filterOverviewTrades();
  const summary = summarizeTrades(trades, state.settings);
  const empty = trades.length === 0;
  $("#overview-empty").hidden = !empty;
  $(".kpi-grid").hidden = empty;
  $(".dashboard-grid").hidden = empty;

  $("#kpi-net").textContent = currency(summary.netPnl, true);
  $("#kpi-net").className = pnlClass(summary.netPnl);
  $("#return-pct").textContent = `${summary.returnPct.toFixed(2)}% on capital`;
  $("#kpi-winrate").textContent = percent(summary.winRate);
  $("#win-count").textContent = `${summary.wins} wins / ${summary.count} trades`;
  $("#kpi-pf").textContent = Number.isFinite(summary.profitFactor) ? summary.profitFactor.toFixed(2) : "∞";
  $("#kpi-r").textContent = `${summary.averageR.toFixed(2)}R`;
  $("#kpi-dd").textContent = currency(summary.maxDrawdown, true);
  $("#kpi-discipline").textContent = percent(summary.disciplinePct);
  $("#ring-value").textContent = percent(summary.disciplinePct);
  $("#discipline-ring").style.setProperty("--score", summary.disciplinePct);
  $("#expectancy-value").textContent = currency(summary.expectancy, true);
  $("#expectancy-value").className = pnlClass(summary.expectancy);
  $("#hold-value").textContent = `${summary.averageHoldingMinutes}m`;
  renderEquityChart(summary.equity);
  renderUnderlyingChart(trades);
  renderStrategyList(trades);
  renderRecentTrades(summary.trades.slice(-6).reverse());
}

function renderEquityChart(series) {
  const svg = $("#equity-chart");
  if (series.length < 2) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="chart-label">Add trades to build your equity curve</text>';
    return;
  }
  const width = 720;
  const height = 195;
  const padding = { left: 54, right: 12, top: 13, bottom: 23 };
  const values = series.map(item => item.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const spread = Math.max(1, max - min);
  min -= spread * .16;
  max += spread * .16;
  const x = index => padding.left + index / (series.length - 1) * (width - padding.left - padding.right);
  const y = value => padding.top + (max - value) / (max - min) * (height - padding.top - padding.bottom);
  const points = series.map((item, index) => `${x(index)},${y(item.value)}`).join(" ");
  const area = `M ${x(0)} ${height - padding.bottom} L ${points.replaceAll(",", " ")} L ${x(series.length - 1)} ${height - padding.bottom} Z`;
  const grid = [0, .25, .5, .75, 1].map(step => {
    const value = max - (max - min) * step;
    const position = padding.top + (height - padding.top - padding.bottom) * step;
    return `<line x1="${padding.left}" y1="${position}" x2="${width - padding.right}" y2="${position}" class="chart-grid-line"/><text x="${padding.left - 7}" y="${position + 3}" text-anchor="end" class="chart-label">${escapeHtml(currency(value, true))}</text>`;
  }).join("");
  const labelIndexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
  const labels = labelIndexes.map(index => `<text x="${x(index)}" y="${height - 4}" text-anchor="middle" class="chart-label">${index === 0 ? "Start" : escapeHtml(prettyDate(series[index].label, true))}</text>`).join("");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `<defs><linearGradient id="equityGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" class="equity-area"/><polyline points="${points}" class="equity-line"/>${series.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.value)}" r="${index === series.length - 1 ? 4 : 2}" class="chart-dot"><title>${escapeHtml(item.label)}: ${escapeHtml(currency(item.value))}</title></circle>`).join("")}${labels}`;
}

function renderUnderlyingChart(trades) {
  const rows = groupPerformance(trades, "underlying", state.settings).slice(0, 6);
  const root = $("#underlying-chart");
  if (!rows.length) {
    root.innerHTML = '<div class="empty-chart">No underlying data yet</div>';
    return;
  }
  const max = Math.max(...rows.map(row => Math.abs(row.netPnl)), 1);
  root.innerHTML = rows.map(row => `<div class="bar-row"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><div class="bar-track"><div class="bar-fill ${pnlClass(row.netPnl)}" style="width:${Math.max(2, Math.abs(row.netPnl) / max * 100)}%"></div></div><strong class="${pnlClass(row.netPnl)}">${escapeHtml(currency(row.netPnl, true))}</strong></div>`).join("");
}

function renderStrategyList(trades) {
  const rows = groupPerformance(trades, trade => trade.setup || trade.strategy || "Unspecified", state.settings).slice(0, 5);
  $("#strategy-list").innerHTML = rows.length ? rows.map(row => `<div class="performance-item"><div><strong>${escapeHtml(row.label)}</strong><span>${row.trades} trades · ${percent(row.winRate)} win rate</span></div><strong class="${pnlClass(row.netPnl)}">${escapeHtml(currency(row.netPnl, true))}</strong></div>`).join("") : '<div class="empty-chart">Add a setup to each trade</div>';
}

function contractLabel(trade) {
  return `${escapeHtml(trade.underlying)} ${escapeHtml(trade.strike)} <small>${escapeHtml(trade.optionType)}</small>`;
}

function renderRecentTrades(trades) {
  $("#recent-trades").innerHTML = trades.map(trade => `<tr><td>${prettyDate(trade.date, true)}</td><td class="contract-name">${contractLabel(trade)}</td><td>${escapeHtml(trade.setup || "—")}</td><td>${trade.quantity}</td><td class="${pnlClass(trade.netPnl)}"><strong>${currency(trade.netPnl, true)}</strong></td><td>${trade.rMultiple === null ? "—" : `${trade.rMultiple.toFixed(2)}R`}</td><td><span class="status-pill ${String(trade.followedPlan) === "true" ? "good" : "bad"}">${String(trade.followedPlan) === "true" ? "Followed" : "Broken"}</span></td></tr>`).join("");
}

function filteredTradeRows() {
  const query = $("#trade-search").value.trim().toLowerCase();
  const exchange = $("#filter-exchange").value;
  const outcome = $("#filter-outcome").value;
  const from = $("#filter-from").value;
  const to = $("#filter-to").value;
  return state.trades.filter(raw => {
    const trade = enrichTrade(raw, state.settings);
    const searchable = [trade.underlying, trade.strike, trade.optionType, trade.setup, trade.strategy, trade.notes, trade.mistakes].join(" ").toLowerCase();
    return (!query || searchable.includes(query)) && (!exchange || trade.exchange === exchange) && (!outcome || trade.outcome === outcome) && (!from || trade.date >= from) && (!to || trade.date <= to);
  });
}

function renderTrades() {
  const rawTrades = filteredTradeRows();
  const summary = summarizeTrades(rawTrades, state.settings);
  $("#filtered-count").textContent = summary.count;
  $("#filtered-pnl").textContent = currency(summary.netPnl, true);
  $("#filtered-pnl").className = pnlClass(summary.netPnl);
  $("#filtered-winrate").textContent = percent(summary.winRate);
  $("#filtered-charges").textContent = currency(summary.totalCharges, true);
  $("#trade-table-empty").hidden = summary.count > 0;
  $("#all-trades").innerHTML = summary.trades.reverse().map(trade => `<tr>
    <td><strong>${prettyDate(trade.date, true)}</strong><br><small>${escapeHtml(trade.entryTime || "—")} → ${escapeHtml(trade.exitTime || "—")}</small></td>
    <td class="contract-name">${contractLabel(trade)}<br><small>${escapeHtml(trade.exchange)} · Exp ${prettyDate(trade.expiry, true)}</small></td>
    <td>${currency(trade.entryPrice)} → ${currency(trade.exitPrice)}</td><td>${trade.quantity}</td>
    <td class="${pnlClass(trade.grossPnl)}">${currency(trade.grossPnl, true)}</td><td>${currency(trade.charges.total, true)}${trade.charges.isManual ? "*" : ""}</td>
    <td class="${pnlClass(trade.netPnl)}"><strong>${currency(trade.netPnl, true)}</strong></td><td>${trade.rMultiple === null ? "—" : `${trade.rMultiple.toFixed(2)}R`}</td>
    <td>${escapeHtml(trade.setup || trade.strategy || "—")}</td><td><span class="status-pill ${trade.grade === "A" ? "good" : trade.grade === "D" ? "bad" : "warning"}">${escapeHtml(trade.grade || "—")}</span></td>
    <td><div class="row-actions"><button data-edit="${escapeHtml(trade.id)}" title="Edit trade">✎</button><button data-delete="${escapeHtml(trade.id)}" title="Delete trade">⌫</button></div></td></tr>`).join("");
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $("#calendar-month").textContent = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(calendarCursor);
  const daily = new Map(dailyPerformance(state.trades, state.settings).map(item => [item.label, item]));
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells = [];
  for (let offset = 0; offset < 42; offset += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + offset);
    const iso = localDate(current);
    const data = daily.get(iso);
    const outside = current.getMonth() !== month;
    cells.push(`<button class="calendar-day ${outside ? "outside" : ""} ${iso === localDate() ? "today" : ""} ${data ? "has-trades" : ""} ${data?.netPnl > 0 ? "profit" : data?.netPnl < 0 ? "loss" : ""}" ${data ? `data-calendar-date="${iso}"` : "disabled"}><span class="day-number">${current.getDate()}</span>${data ? `<strong class="day-pnl ${pnlClass(data.netPnl)}">${currency(data.netPnl, true)}</strong><span class="day-count">${data.trades} trade${data.trades === 1 ? "" : "s"}</span>` : ""}</button>`);
  }
  $("#calendar-grid").innerHTML = cells.join("");
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthDays = [...daily.values()].filter(item => item.label.startsWith(prefix));
  const monthPnl = monthDays.reduce((sum, item) => sum + item.netPnl, 0);
  $("#month-pnl").textContent = currency(monthPnl, true);
  $("#month-pnl").className = pnlClass(monthPnl);
  $("#green-days").textContent = monthDays.filter(item => item.netPnl > 0).length;
  $("#red-days").textContent = monthDays.filter(item => item.netPnl < 0).length;
  renderCalendarInsights(monthDays);
}

function renderCalendarInsights(monthDays) {
  if (!monthDays.length) {
    $("#calendar-insight-title").textContent = "No trades recorded this month";
    $("#calendar-insight-text").textContent = "Your strongest and weakest days will appear here.";
  } else {
    const best = monthDays.reduce((result, day) => day.netPnl > result.netPnl ? day : result);
    const worst = monthDays.reduce((result, day) => day.netPnl < result.netPnl ? day : result);
    $("#calendar-insight-title").textContent = `Best day: ${prettyDate(best.label)}`;
    $("#calendar-insight-text").textContent = `${currency(best.netPnl)} best day; ${currency(worst.netPnl)} weakest day. Review process differences, not only the outcomes.`;
  }
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const rows = weekdays.map((name, index) => {
    const matching = monthDays.filter(day => new Date(`${day.label}T00:00:00`).getDay() === index + 1);
    return { name, pnl: matching.reduce((sum, day) => sum + day.netPnl, 0), count: matching.reduce((sum, day) => sum + day.trades, 0) };
  });
  $("#weekday-performance").innerHTML = rows.map(row => `<div class="weekday-stat"><span>${row.name} · ${row.count}T</span><strong class="${pnlClass(row.pnl)}">${currency(row.pnl, true)}</strong></div>`).join("");
}

function reviewFor(date) {
  return state.reviews.find(review => review.date === date);
}

function loadReview(date) {
  const form = $("#review-form");
  form.reset();
  $("#review-date").value = date;
  const review = reviewFor(date) || {};
  [...form.elements].forEach(element => {
    if (!element.name || element.name === "date") return;
    if (element.type === "checkbox") element.checked = Boolean(review[element.name]);
    else if (review[element.name] !== undefined) element.value = review[element.name];
  });
  if (!review.dailyRisk) form.elements.dailyRisk.value = state.settings.dailyLossLimit;
  if (!review.maxTrades) form.elements.maxTrades.value = state.settings.maxTradesPerDay;
  renderReviewScore(date);
  renderReviewHistory();
}

function renderReviewScore(date) {
  const review = reviewFor(date) || {};
  const checklist = ["checkedEvents", "markedLevels", "definedBias", "acceptedRisk"].filter(key => review[key]).length;
  const trades = state.trades.filter(trade => trade.date === date);
  const summary = summarizeTrades(trades, state.settings);
  let score = checklist * 10;
  if (review.marketView && review.tradingPlan) score += 15;
  if (review.wentWell || review.improve) score += 10;
  if (review.nextRule) score += 5;
  if (trades.length) score += Math.round(summary.disciplinePct * .2);
  if (summary.netPnl >= -number(review.dailyRisk || state.settings.dailyLossLimit)) score += 10;
  score = Math.min(100, score);
  $("#review-score").textContent = score;
  $("#review-score-note").textContent = trades.length
    ? `${trades.length} trades · ${percent(summary.disciplinePct)} plan adherence · ${currency(summary.netPnl)} net P&L.`
    : "Complete your checklist and record trades to calculate a process score.";
}

function renderReviewHistory() {
  const reviews = [...state.reviews].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  $("#review-history").innerHTML = reviews.length ? reviews.map(review => `<button class="review-history-item text-button" data-review-date="${review.date}"><strong>${prettyDate(review.date)}</strong><span>${escapeHtml(review.nextRule || review.improve || review.wentWell || "Review saved")}</span></button>`).join("") : '<div class="empty-chart">No reviews saved yet</div>';
}

function fillSettingsForm() {
  const form = $("#settings-form");
  Object.entries(state.settings).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

function renderWelcome() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("#welcome-title").textContent = `${greeting}, ${state.settings.traderName || "Trader"}`;
}

function renderAll() {
  applyTheme();
  renderWelcome();
  renderRisk();
  renderOverview();
  renderTrades();
  renderCalendar();
  renderReviewScore($("#review-date").value || localDate());
  renderReviewHistory();
}

function formTrade() {
  const form = $("#trade-form");
  const values = Object.fromEntries(new FormData(form));
  numericTradeFields.forEach(key => { values[key] = values[key] === "" ? "" : number(values[key]); });
  values.manualCharges = values.manualCharges === "" ? "" : number(values.manualCharges);
  values.followedPlan = String(form.elements.followedPlan.checked);
  values.underlying = values.underlying.trim().toUpperCase();
  return values;
}

function openTradeDialog(trade = null) {
  const form = $("#trade-form");
  form.reset();
  form.elements.date.value = localDate();
  form.elements.entryTime.value = "09:30";
  form.elements.exitTime.value = "10:00";
  form.elements.executedOrders.value = 2;
  form.elements.lots.value = 1;
  form.elements.lotSize.value = 65;
  form.elements.followedPlan.checked = true;
  $("#trade-dialog-title").textContent = trade ? "Edit trade" : "Add a trade";
  if (trade) {
    [...form.elements].forEach(element => {
      if (!element.name || trade[element.name] === undefined) return;
      if (element.type === "checkbox") element.checked = String(trade[element.name]) === "true";
      else element.value = trade[element.name];
    });
  }
  renderTradePreview();
  $("#trade-dialog").showModal();
}

function renderTradePreview() {
  const trade = formTrade();
  const enriched = enrichTrade(trade, state.settings);
  const values = [
    enriched.quantity,
    currency(enriched.grossPnl, true),
    currency(enriched.charges.total, true),
    currency(enriched.netPnl, true),
    enriched.rMultiple === null ? "—" : `${enriched.rMultiple.toFixed(2)}R`
  ];
  $$("#trade-preview strong").forEach((element, index) => {
    element.textContent = values[index];
    element.className = index === 1 || index === 3 ? pnlClass(index === 1 ? enriched.grossPnl : enriched.netPnl) : "";
  });
}

function normalizeImportedTrade(trade) {
  const normalized = { ...trade, id: makeId() };
  numericTradeFields.forEach(key => { normalized[key] = trade[key] === "" ? "" : number(trade[key]); });
  normalized.manualCharges = trade.manualCharges === "" ? "" : number(trade.manualCharges);
  normalized.followedPlan = String(trade.followedPlan).toLowerCase() === "true" ? "true" : "false";
  normalized.underlying = String(trade.underlying || "").trim().toUpperCase();
  return normalized;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindEvents() {
  $$(".nav-item").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
  $$("[data-go]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
  $$("[data-add-trade]").forEach(button => button.addEventListener("click", () => openTradeDialog()));
  $("#add-trade-button").addEventListener("click", () => openTradeDialog());
  $("#menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#theme-button").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    saveState();
    applyTheme();
  });
  $("#overview-period").addEventListener("change", event => { overviewPeriod = event.target.value; renderOverview(); });

  ["#trade-search", "#filter-exchange", "#filter-outcome", "#filter-from", "#filter-to"].forEach(selector => {
    $(selector).addEventListener(selector === "#trade-search" ? "input" : "change", renderTrades);
  });
  $("#clear-filters").addEventListener("click", () => {
    $("#trade-search").value = ""; $("#filter-exchange").value = ""; $("#filter-outcome").value = ""; $("#filter-from").value = ""; $("#filter-to").value = ""; renderTrades();
  });
  $("#all-trades").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit]");
    const remove = event.target.closest("[data-delete]");
    if (edit) openTradeDialog(state.trades.find(trade => trade.id === edit.dataset.edit));
    if (remove && confirm("Delete this trade permanently from this browser?")) {
      state.trades = state.trades.filter(trade => trade.id !== remove.dataset.delete);
      saveState(); renderAll(); toast("Trade deleted");
    }
  });

  $("#trade-form").addEventListener("input", renderTradePreview);
  $("#trade-form").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const trade = formTrade();
    if (!trade.date || !trade.underlying || !trade.expiry || !trade.entryPrice || !trade.exitPrice) {
      toast("Complete all required trade fields"); return;
    }
    const existingIndex = state.trades.findIndex(item => item.id === trade.id);
    if (existingIndex >= 0) state.trades[existingIndex] = trade;
    else state.trades.push({ ...trade, id: makeId(), createdAt: new Date().toISOString() });
    saveState(); $("#trade-dialog").close(); renderAll(); toast(existingIndex >= 0 ? "Trade updated" : "Trade saved");
  });

  $("#sample-data-button").addEventListener("click", () => {
    if (state.trades.length && !confirm("Add sample trades alongside your existing trades?")) return;
    state.trades.push(...createSampleTrades()); saveState(); renderAll(); toast("Sample trades loaded");
  });
  $("#export-button").addEventListener("click", () => {
    download(`tradecompound-trades-${localDate()}.csv`, tradesToCsv(filteredTradeRows()), "text/csv;charset=utf-8");
    toast("Trade CSV exported");
  });
  $("#import-button").addEventListener("click", () => $("#csv-file").click());
  $("#csv-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const rows = parseCsv(await file.text()).filter(row => row.date && row.underlying);
      if (!rows.length) throw new Error("No valid rows");
      state.trades.push(...rows.map(normalizeImportedTrade)); saveState(); renderAll(); toast(`${rows.length} trades imported`);
    } catch { toast("Import failed. Use the TradeCompound CSV headers."); }
    event.target.value = "";
  });

  $("#prev-month").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); renderCalendar(); });
  $("#next-month").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); renderCalendar(); });
  $("#calendar-grid").addEventListener("click", event => {
    const day = event.target.closest("[data-calendar-date]");
    if (!day) return;
    $("#filter-from").value = day.dataset.calendarDate; $("#filter-to").value = day.dataset.calendarDate; navigate("trades"); renderTrades();
  });

  $("#review-date").addEventListener("change", event => loadReview(event.target.value));
  $("#review-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const review = Object.fromEntries(new FormData(form));
    ["checkedEvents", "markedLevels", "definedBias", "acceptedRisk"].forEach(key => { review[key] = form.elements[key].checked; });
    const index = state.reviews.findIndex(item => item.date === review.date);
    if (index >= 0) state.reviews[index] = review; else state.reviews.push(review);
    saveState(); renderReviewScore(review.date); renderReviewHistory(); $("#review-save-status").textContent = `Saved at ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`; toast("Daily review saved");
  });
  $("#review-history").addEventListener("click", event => {
    const button = event.target.closest("[data-review-date]");
    if (button) loadReview(button.dataset.reviewDate);
  });

  $("#settings-form").addEventListener("submit", event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      if (key === "traderName" || key === "theme") return;
      values[key] = number(values[key], DEFAULT_SETTINGS[key]);
    });
    state.settings = { ...state.settings, ...values };
    saveState(); renderAll(); $("#settings-status").textContent = `Saved at ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`; toast("Settings saved");
  });
  $("#json-export").addEventListener("click", () => { download(`tradecompound-full-backup-${localDate()}.json`, JSON.stringify(state, null, 2), "application/json"); toast("Full backup downloaded"); });
  $("#reset-data").addEventListener("click", () => {
    if (!confirm("This permanently deletes all trades, reviews and settings stored in this browser. Continue?")) return;
    localStorage.removeItem(STORE_KEY); state = loadState(); fillSettingsForm(); loadReview(localDate()); renderAll(); toast("Local journal reset");
  });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1), false));
}

function initialize() {
  const now = new Date();
  $("#today-label").textContent = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(now).toUpperCase();
  $("#review-date").value = localDate();
  fillSettingsForm();
  bindEvents();
  loadReview(localDate());
  renderAll();
  navigate(location.hash.slice(1) || "overview", false);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initialize();
