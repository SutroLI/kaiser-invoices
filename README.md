# Kaiser Invoice Reader

Static web app for extracting the **Membership Detail** table from Kaiser Permanente group bills and exporting a spreadsheet.

Hosted on GitHub Pages at: `https://sutroli.github.io/kaiser-invoices/`

## What it extracts

One row per subscriber, matching the fields Amira needs:

- Name
- Family Count
- Coverage
- Status
- Medical Plan
- Medical current charge

The Membership Detail table often starts around page 3 and can overflow by one (or more) rows onto the next page. Those leftover rows are included. Retro-activity continuation lines are not treated as extra people. Empty COBRA / N/A groups are skipped.

Scanned Xerox PDFs have no text layer — pages are OCR’d in the browser. Native (searchable) Kaiser PDFs use the embedded text instead.

## Development

```bash
npm install
npm run dev
```

## Build for GitHub Pages

```bash
npm run build:pages
```

## Deployment

Pushes to `main` automatically deploy via GitHub Actions. Enable GitHub Pages in repo settings with source **GitHub Actions**.
