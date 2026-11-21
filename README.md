# Folio — Every Entry Tells a Story.

**A local-first personal and business finance tracker.**

Folio is a lightweight, privacy-conscious Progressive Web App (PWA) designed to make everyday financial tracking simpler. Whether you're managing personal expenses or keeping track of business cash flow, Folio brings everything together in one clean, organized interface.

No complicated spreadsheets. No unnecessary complexity. Just your finances, organized.

🌐 **Live Application:** https://folio-eight-brown.vercel.app/

---

## ✨ Features

### 📊 Financial Dashboard
- Get an overview of your daily and monthly financial activity.
- Track money received, money spent and net cash flow.
- View personal and business financial summaries separately.
- Access recent transactions directly from the dashboard.

### 💳 Quick Entry
- Quickly record money spent or received.
- Switch between Personal and Business contexts.
- Organize transactions using customizable categories.
- Record payment modes, dates, times, people and notes.
- Edit or delete existing transactions.

### 📁 Transaction Management
- Dedicated transaction history.
- Filter transactions by date, category and context.
- Maintain separate Personal and Business records.
- Track cash and online transactions.

### 📈 Financial Reports
- View financial summaries and cash flow.
- Analyze spending and income by category.
- Compare Personal and Business activity.
- Understand cash versus online transactions.

### 👤 Independent Profiles
- Create multiple isolated local profiles.
- Protect individual profiles with optional 4-digit PINs.
- Maintain separate financial records for different users or purposes.

### 📴 Offline-First Experience
- Install Folio as a Progressive Web App.
- Access your financial records without an internet connection.
- Store entries persistently using IndexedDB.
- Continue tracking transactions even when offline.

### 💾 Data Management
- Export financial records as CSV.
- Create JSON backups.
- Restore data from previously created backups.
- Keep control over your financial records.

### 📱 Designed for Everyday Use
- Responsive interface for phones, tablets and desktops.
- Mobile-friendly transaction entry.
- Safe-area-aware mobile layouts.
- Readable typography and intuitive navigation.
- Lightweight notification system for user feedback.

---

## 🛠️ Built With

| Technology | Purpose |
|---|---|
| React | User interface |
| TypeScript | Application logic and type safety |
| Vite | Development and production builds |
| IndexedDB | Persistent local data storage |
| Progressive Web App | Installability and offline support |
| CSS | Responsive styling and interface design |
| Vercel | Deployment and hosting |

---

## 🚀 Getting Started

Want to run Folio locally?

### Prerequisites
- Node.js
- npm

### Installation

Clone the repository:

```bash
git clone YOUR_REPOSITORY_URL
```

Navigate into the project:

```bash
cd folio
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL provided by Vite in your browser.

### Production Build

```bash
npm run build
```

### Type Checking

```bash
npm run lint
```

---

## 🔐 Privacy & Data Storage

Folio follows a local-first approach.

Financial records are stored locally in the browser using IndexedDB. The application is designed to work without requiring a continuously active internet connection.

- No account registration is required for local profile usage.
- Profiles maintain independent financial records.
- Users can create their own backups.
- JSON and CSV exports provide control over their data.

**Important:** Local-first storage means data is associated with the browser and device where it is stored. Users should maintain backups when changing devices or clearing browser data. Folio does not currently provide automatic cloud synchronization.

---

## 🗺️ Project Vision

Folio was built around a simple idea: managing money should not feel like managing a complicated spreadsheet.

The goal is to create a practical financial companion that makes recording, organizing and understanding everyday transactions effortless.

The focus is on simplicity, data ownership, reliability and accessibility.

---

## 📌 Current Status

**Live and usable.**

Folio is deployed and available as a web application and installable PWA.

🌐 **Try Folio:** https://folio-eight-brown.vercel.app/

---

<div align="center">

### Folio

*Every entry tells a story.*

Built with a focus on simplicity, ownership and everyday usability.

</div>
