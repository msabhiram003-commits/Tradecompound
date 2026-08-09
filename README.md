# TradeCompound

TradeCompound is a fast, private trading journal built for Indian NSE and BSE options buyers. It turns a trade log into a decision dashboard without requiring a broker login, subscription, database, or analytics service.

> The application is a journal and calculation aid—not trading, tax, accounting, or investment advice.

## What it tracks

- NSE/BSE, underlying, expiry, strike, CE/PE, lot size and quantity
- Buy/sell time and premium, stop, target, planned risk and actual charges
- Gross P&L, estimated net P&L, R-multiple, holding time and risk/reward
- Strategy, setup, market bias, trade grade, emotions, mistakes and notes
- Daily plan, pre-market checklist, post-market learning and next-session rule

## Dashboards

- Net P&L, return on starting capital, win rate and profit factor
- Average R, expectancy, maximum drawdown and plan adherence
- Equity curve, P&L by underlying and setup leaderboard
- Searchable/filterable trade ledger
- Monthly P&L calendar and weekday analysis
- Daily loss-limit monitor and process score

## Privacy and backups

Trade data and reviews are stored in the browser's `localStorage`. They are never added to this GitHub repository and are not sent to a server. Use **Export CSV** for trade data and **Download full backup** in Settings for a JSON backup. Clearing browser/site storage will erase the local journal.

## Use it locally

No install or build is required. Because browsers restrict JavaScript modules opened as `file://`, serve the folder locally:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Tests

Node.js 20 or newer is required only for development checks:

```bash
npm run check
npm test
```

## Publish with GitHub Pages

The included workflow tests and deploys the journal after every push to `main`. In the repository, open **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**, and then run the `Test and deploy TradeCompound` workflow. The expected project URL is:

`https://msabhiram003-commits.github.io/Tradecompound/`

## CSV import

Start with [`data/trade-import-template.csv`](data/trade-import-template.csv). Exported TradeCompound CSV files can be re-imported directly. New imports are appended; they do not overwrite existing records.

## Charge estimator

All charge rates are editable under Settings. The defaults model a long equity-option round trip and include brokerage, exchange transaction charge, STT on the sell premium, SEBI/IPFT fees, buy-side stamp duty and GST. A manual `Actual charges` value from the contract note overrides the estimate for that trade.

The initial reference values include:

- NSE equity-options transaction charge: ₹35.03 per lakh of premium value, from the [NSE circular effective 1 October 2024](https://nsearchives.nseindia.com/content/circulars/FA64232.pdf).
- BSE Sensex/Bankex options transaction charge: ₹3,250 per crore of premium turnover, listed through the [BSE derivatives fee notices](https://www.bseindia.com/static/members/tfderivative).
- Options-sale STT: 0.15% of option premium for trades from 1 April 2026, shown in the [Income Tax Department Budget 2026 FAQ](https://www.incometaxindia.gov.in/documents/20117/15766092/FAQs-Budget-2026%2BUpdated.pdf) and the [NSE statutory levies table](https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies).

Rates can change and actual broker calculations can differ. Always reconcile the estimate against the broker contract note, especially for exercised/assigned options, non-standard brokerage plans, additional clearing charges, or products outside Sensex/Bankex on BSE.

## Technology

The project is deliberately small: semantic HTML, responsive CSS, native JavaScript modules, SVG/CSS charts, browser storage, a service worker for offline use, and Node's built-in test runner. There are no runtime libraries or third-party trackers.

Licensed under the [MIT License](LICENSE).
