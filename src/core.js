export const DEFAULT_SETTINGS = Object.freeze({
  traderName: "Abhiram",
  startingCapital: 100000,
  dailyLossLimit: 2000,
  maxRiskPerTrade: 1000,
  maxTradesPerDay: 4,
  brokeragePerOrder: 20,
  nseTransactionPct: 0.03503,
  bseTransactionPct: 0.0325,
  sttSellPct: 0.15,
  sebiRatePerCrore: 10,
  ipftRatePerCrore: 10,
  stampBuyPct: 0.003,
  gstPct: 18,
  theme: "dark"
});

export const TRADE_COLUMNS = [
  "date", "exchange", "underlying", "expiry", "strike", "optionType", "entryTime",
  "exitTime", "entryPrice", "exitPrice", "lots", "lotSize", "executedOrders", "stopLoss",
  "target", "plannedRisk", "strategy", "setup", "marketBias", "followedPlan", "grade",
  "emotionBefore", "emotionAfter", "mistakes", "notes", "manualCharges"
];

export function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

export function calculateCharges(trade, settings = DEFAULT_SETTINGS) {
  const quantity = Math.max(0, number(trade.quantity) || number(trade.lots) * number(trade.lotSize));
  const buyValue = Math.max(0, number(trade.entryPrice) * quantity);
  const sellValue = Math.max(0, number(trade.exitPrice) * quantity);
  const turnover = buyValue + sellValue;
  const executedOrders = Math.max(0, number(trade.executedOrders, 2));
  const exchangePct = String(trade.exchange).toUpperCase() === "BSE"
    ? number(settings.bseTransactionPct)
    : number(settings.nseTransactionPct);

  const brokerage = number(settings.brokeragePerOrder) * executedOrders;
  const exchangeCharges = turnover * exchangePct / 100;
  const stt = sellValue * number(settings.sttSellPct) / 100;
  const sebi = turnover / 10000000 * number(settings.sebiRatePerCrore);
  const ipft = turnover / 10000000 * number(settings.ipftRatePerCrore);
  const stampDuty = buyValue * number(settings.stampBuyPct) / 100;
  const gst = (brokerage + exchangeCharges + sebi + ipft) * number(settings.gstPct) / 100;
  const estimatedTotal = brokerage + exchangeCharges + stt + sebi + ipft + stampDuty + gst;
  const hasManualCharges = trade.manualCharges !== "" && trade.manualCharges !== null && trade.manualCharges !== undefined;
  const total = hasManualCharges ? Math.max(0, number(trade.manualCharges)) : estimatedTotal;

  return {
    quantity,
    buyValue: round(buyValue),
    sellValue: round(sellValue),
    turnover: round(turnover),
    brokerage: round(brokerage),
    exchangeCharges: round(exchangeCharges),
    stt: round(stt),
    sebi: round(sebi),
    ipft: round(ipft),
    stampDuty: round(stampDuty),
    gst: round(gst),
    estimatedTotal: round(estimatedTotal),
    total: round(total),
    isManual: hasManualCharges
  };
}

function holdingMinutes(trade) {
  if (!trade.date || !trade.entryTime || !trade.exitTime) return null;
  const entry = new Date(`${trade.date}T${trade.entryTime}`);
  const exitDate = trade.exitDate || trade.date;
  const exit = new Date(`${exitDate}T${trade.exitTime}`);
  const difference = (exit - entry) / 60000;
  return Number.isFinite(difference) && difference >= 0 ? round(difference, 0) : null;
}

export function enrichTrade(trade, settings = DEFAULT_SETTINGS) {
  const charges = calculateCharges(trade, settings);
  const grossPnl = (number(trade.exitPrice) - number(trade.entryPrice)) * charges.quantity;
  const netPnl = grossPnl - charges.total;
  const calculatedRisk = Math.max(0, number(trade.entryPrice) - number(trade.stopLoss)) * charges.quantity;
  const plannedRisk = Math.max(0, number(trade.plannedRisk) || calculatedRisk);
  const plannedReward = Math.max(0, number(trade.target) - number(trade.entryPrice)) * charges.quantity;
  const rMultiple = plannedRisk > 0 ? netPnl / plannedRisk : null;

  return {
    ...trade,
    quantity: charges.quantity,
    charges,
    grossPnl: round(grossPnl),
    netPnl: round(netPnl),
    plannedRisk: round(plannedRisk),
    plannedReward: round(plannedReward),
    plannedRR: plannedRisk > 0 ? round(plannedReward / plannedRisk) : null,
    rMultiple: rMultiple === null ? null : round(rMultiple),
    holdingMinutes: holdingMinutes(trade),
    outcome: netPnl > 0.005 ? "Win" : netPnl < -0.005 ? "Loss" : "Flat"
  };
}

export function maxDrawdown(pnls, startingCapital = 0) {
  let equity = number(startingCapital);
  let peak = equity;
  let maximum = 0;
  for (const pnl of pnls) {
    equity += number(pnl);
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }
  return round(maximum);
}

export function summarizeTrades(rawTrades, settings = DEFAULT_SETTINGS) {
  const trades = rawTrades
    .map(trade => enrichTrade(trade, settings))
    .sort((a, b) => `${a.date} ${a.exitTime || ""}`.localeCompare(`${b.date} ${b.exitTime || ""}`));
  const wins = trades.filter(trade => trade.netPnl > 0);
  const losses = trades.filter(trade => trade.netPnl < 0);
  const netPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const rTrades = trades.filter(trade => trade.rMultiple !== null);
  const plannedTrades = trades.filter(trade => trade.followedPlan !== "");
  const heldTrades = trades.filter(trade => trade.holdingMinutes !== null);
  const capital = number(settings.startingCapital);
  let running = capital;
  const equity = [{ label: "Start", value: capital }];
  for (const trade of trades) {
    running += trade.netPnl;
    equity.push({ label: trade.date, value: round(running), pnl: trade.netPnl });
  }

  return {
    trades,
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    netPnl: round(netPnl),
    totalCharges: round(trades.reduce((sum, trade) => sum + trade.charges.total, 0)),
    winRate: trades.length ? round(wins.length / trades.length * 100, 1) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0,
    expectancy: trades.length ? round(netPnl / trades.length) : 0,
    averageWin: wins.length ? round(grossProfit / wins.length) : 0,
    averageLoss: losses.length ? round(-grossLoss / losses.length) : 0,
    averageR: rTrades.length ? round(rTrades.reduce((sum, trade) => sum + trade.rMultiple, 0) / rTrades.length) : 0,
    maxDrawdown: maxDrawdown(trades.map(trade => trade.netPnl), capital),
    returnPct: capital > 0 ? round(netPnl / capital * 100) : 0,
    disciplinePct: plannedTrades.length
      ? round(plannedTrades.filter(trade => String(trade.followedPlan) === "true").length / plannedTrades.length * 100, 1)
      : 0,
    averageHoldingMinutes: heldTrades.length
      ? round(heldTrades.reduce((sum, trade) => sum + trade.holdingMinutes, 0) / heldTrades.length, 0)
      : 0,
    bestTrade: trades.length ? trades.reduce((best, trade) => trade.netPnl > best.netPnl ? trade : best) : null,
    worstTrade: trades.length ? trades.reduce((worst, trade) => trade.netPnl < worst.netPnl ? trade : worst) : null,
    equity
  };
}

export function groupPerformance(rawTrades, key, settings = DEFAULT_SETTINGS) {
  const grouped = new Map();
  for (const trade of rawTrades.map(item => enrichTrade(item, settings))) {
    const label = String(typeof key === "function" ? key(trade) : trade[key] || "Unspecified");
    const current = grouped.get(label) || { label, trades: 0, wins: 0, netPnl: 0, charges: 0 };
    current.trades += 1;
    current.wins += trade.netPnl > 0 ? 1 : 0;
    current.netPnl += trade.netPnl;
    current.charges += trade.charges.total;
    grouped.set(label, current);
  }
  return [...grouped.values()]
    .map(item => ({ ...item, netPnl: round(item.netPnl), charges: round(item.charges), winRate: round(item.wins / item.trades * 100, 1) }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export function dailyPerformance(rawTrades, settings = DEFAULT_SETTINGS) {
  return groupPerformance(rawTrades, "date", settings).sort((a, b) => a.label.localeCompare(b.label));
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function tradesToCsv(trades) {
  const header = TRADE_COLUMNS.join(",");
  const rows = trades.map(trade => TRADE_COLUMNS.map(column => csvEscape(trade[column])).join(","));
  return [header, ...rows].join("\n");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => header.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function createSampleTrades(today = new Date()) {
  const date = offset => {
    const value = new Date(today);
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const base = {
    exchange: "NSE", expiry: date(3), entryTime: "09:35", exitTime: "10:20", lots: 1,
    lotSize: 65, executedOrders: 2, followedPlan: "true", marketBias: "Bullish", grade: "B",
    manualCharges: "", emotionBefore: "Calm", emotionAfter: "Calm", mistakes: "", notes: "Sample trade"
  };
  return [
    { ...base, id: crypto.randomUUID(), date: date(-9), underlying: "NIFTY", strike: 24800, optionType: "CE", entryPrice: 118, exitPrice: 154, stopLoss: 96, target: 160, strategy: "Momentum", setup: "Opening range breakout" },
    { ...base, id: crypto.randomUUID(), date: date(-8), underlying: "BANKNIFTY", strike: 53500, optionType: "PE", entryPrice: 210, exitPrice: 171, stopLoss: 178, target: 272, strategy: "Breakdown", setup: "VWAP rejection", followedPlan: "false", grade: "C", mistakes: "Moved stop", emotionAfter: "Frustrated", lotSize: 30 },
    { ...base, id: crypto.randomUUID(), date: date(-7), underlying: "NIFTY", strike: 24900, optionType: "PE", entryPrice: 92, exitPrice: 128, stopLoss: 75, target: 130, strategy: "Reversal", setup: "Liquidity sweep" },
    { ...base, id: crypto.randomUUID(), date: date(-5), underlying: "SENSEX", exchange: "BSE", strike: 81000, optionType: "CE", entryPrice: 142, exitPrice: 119, stopLoss: 121, target: 185, strategy: "Momentum", setup: "First pullback", lotSize: 20, followedPlan: "true" },
    { ...base, id: crypto.randomUUID(), date: date(-4), underlying: "NIFTY", strike: 25000, optionType: "CE", entryPrice: 106, exitPrice: 163, stopLoss: 86, target: 160, strategy: "Trend", setup: "VWAP reclaim", grade: "A" },
    { ...base, id: crypto.randomUUID(), date: date(-3), underlying: "BANKNIFTY", strike: 54000, optionType: "CE", entryPrice: 185, exitPrice: 181, stopLoss: 155, target: 245, strategy: "Breakout", setup: "Range breakout", lotSize: 30, grade: "B" },
    { ...base, id: crypto.randomUUID(), date: date(-2), underlying: "NIFTY", strike: 25100, optionType: "PE", entryPrice: 128, exitPrice: 102, stopLoss: 105, target: 175, strategy: "Reversal", setup: "Failed breakout", followedPlan: "true" },
    { ...base, id: crypto.randomUUID(), date: date(-1), underlying: "NIFTY", strike: 25050, optionType: "CE", entryPrice: 98, exitPrice: 139, stopLoss: 80, target: 140, strategy: "Trend", setup: "EMA pullback", grade: "A" }
  ];
}
