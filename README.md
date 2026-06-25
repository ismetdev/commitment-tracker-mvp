# Commitment Tracker

A lightweight web app for tracking recurring financial commitments, generating monthly snapshots, tracking payments, and keeping light records of personal debts. Built with Node.js, Express, and SQLite.

## Features

* **Commitments** — Maintain a list of recurring monthly commitments (bills, subscriptions, obligations).
* **Monthly Snapshots** — Generate a month from your active commitments, then mark each line as paid or unpaid. Add one-off ad-hoc lines for that month only.
* **Dashboard** — See your current status at a glance, with first-run guidance that adapts as you add commitments and generate months.
* **Debts** — Optional light tracking of personal loans (money owed to family or friends), including balances and payment history.
* **History** — Browse previously generated months with their totals.
* **Backup & Export** — Download a consistent copy of the SQLite database, or export your data as CSV.

## Tech Stack

* **Backend:** Node.js + Express
* **Database:** SQLite (via `better-sqlite3`)
* **Frontend:** Vanilla HTML, CSS, and JavaScript (no framework)

## Project Structure

```text
.
├── server.js            # App entry point; mounts routes and serves static files
├── db.js                # Database connection and schema setup
├── routes/
│   ├── commitments.js   # Recurring commitments CRUD
│   ├── monthly.js       # Monthly snapshot generation, lines, payments
│   ├── debts.js         # Debt accounts and payments
│   ├── dashboard.js     # Dashboard summary data
│   ├── backup.js        # SQLite backup + CSV export
│   └── reset.js         # Reset / clear data
└── public/
    ├── index.html       # Single-page UI
    ├── css/
    │   └── style.css
    └── js/
        └── app.js       # Frontend logic
```

## Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (LTS recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/ismetdev/commitment-tracker-mvp.git
cd commitment-tracker-mvp

# Install dependencies
npm install

# Start the server
node server.js
```

Then open your browser at:

```text
http://localhost:3000
```

(or whatever port is configured in `server.js`).

> The SQLite database file is created automatically on first run. It is excluded from version control via `.gitignore`, so your personal financial data stays local and is never committed.

## Data & Privacy

This app stores all data locally in a SQLite database on your own machine. No data is sent anywhere. Database files (`*.sqlite`) are git-ignored and are never uploaded to this repository.

## License

Personal project — All rights reserved.
