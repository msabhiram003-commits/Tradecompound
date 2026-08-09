import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  calculateCharges,
  enrichTrade,
  maxDrawdown,
  parseCsv,
  summarizeTrades,
  tradesToCsv
} from "../src/core.js";

const winningTrade = {
  id: "one", date: "2026-08-03", exchange: "NSE", underlying: "NIFTY",
  entryPrice: 100, exitPrice: 130, lots: 1, lotSize: 65, executedOrders: 2,
  stopLoss: 80, target: 140, followedPlan: "true", manualCharges: ""
};

test("calculates quantity, turnover and positive estimated charges", () => {
  const charges = calculateCharges(winningTrade, DEFAULT_SETTINGS);
  assert.equal(charges.quantity, 65);
  assert.equal(charges.turnover, 14950);
  assert.ok(charges.total > 40);
  assert.ok(charges.stt > 0);
});

test("manual contract-note charges override the estimate", () => {
  const charges = calculateCharges({ ...winningTrade, manualCharges: 77.25 }, DEFAULT_SETTINGS);
  assert.equal(charges.total, 77.25);
  assert.equal(charges.isManual, true);
});

test("enriches an option buy with net pnl and R multiple", () => {
  const trade = enrichTrade({ ...winningTrade, manualCharges: 50 }, DEFAULT_SETTINGS);
  assert.equal(trade.grossPnl, 1950);
  assert.equal(trade.netPnl, 1900);
  assert.equal(trade.plannedRisk, 1300);
  assert.equal(trade.rMultiple, 1.46);
  assert.equal(trade.outcome, "Win");
});

test("summarizes wins, losses, profit factor and discipline", () => {
  const losingTrade = { ...winningTrade, id: "two", date: "2026-08-04", exitPrice: 80, followedPlan: "false", manualCharges: 50 };
  const summary = summarizeTrades([winningTrade, losingTrade], DEFAULT_SETTINGS);
  assert.equal(summary.count, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.winRate, 50);
  assert.equal(summary.disciplinePct, 50);
  assert.ok(summary.maxDrawdown > 0);
});

test("calculates maximum drawdown from an equity sequence", () => {
  assert.equal(maxDrawdown([1000, -400, -900, 300], 100000), 1300);
});

test("CSV export and import preserve commas and quotes", () => {
  const source = [{ ...winningTrade, notes: "Waited, then entered \"cleanly\"" }];
  const csv = tradesToCsv(source);
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].notes, source[0].notes);
  assert.equal(parsed[0].underlying, "NIFTY");
});
