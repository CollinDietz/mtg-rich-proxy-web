# MTG Rich Proxy — Web Edition

**Make print-ready Magic: The Gathering proxy sheets in your browser.** Paste a decklist, select Scryfall printings, and download a PDF with true-size cards and crop marks. No Python, `uv`, Node.js, server, account, or installation is required for visitors.

This is a **standalone GitHub Pages project**, based on the layout and printing-selection ideas of [mtg_rich_proxy (Python CLI)](https://github.com/CollinDietz/mtg_rich_proxy). It does **not** alter that repository or require its code.

## Features

- **9 cards per page by default**, portrait orientation, zero gaps, shared guillotine cut lines.
- Optional 8-up and 6-up **landscape** layouts.
- **US Letter (8.5 × 11 in)** pages, exact **2.5 × 3.5 in** finished card size (180 × 252 PDF points; never scaled).
- Crop marks extend from **0.5 PDF points** inside the paper edges, staying outside the artwork.
- Printing selection: **latest normal English paper printing** (default), or **most expensive eligible nonfoil USD printing**.
- Explicit `(set) collector-number` entries are supported and override the default printing mode, subject to the artwork filters.
- Options to avoid textless cards, favor standard artwork, and print both faces of double-faced cards.
- High-resolution PNG artwork or compressed large JPEG input (both embedded as quality-97% JPEG for manageable PDFs).
- **IndexedDB image cache by Scryfall printing ID**. Different printings coexist; requesting the same one again reuses the bytes.
- No backend, no build system, no CDN JavaScript. Images and printing metadata come directly from [Scryfall](https://scryfall.com/).

## Publish as a new repository on GitHub Pages

### 1. Create a repository

1. Download and extract the `mtg-rich-proxy-web.zip` archive.
2. Sign in to GitHub and click **New repository**.
3. Choose a repository name, e.g. `mtg-rich-proxy-web`, and select **Public**.
4. **Do not initialize** it with a README or `.gitignore`; both are already included in the ZIP.
5. Click **Create repository**.

### 2. Upload the ZIP contents

The ZIP includes `site/`, `.github/workflows/deploy.yml`, `tests/`, and the README. **Upload the extracted files and folders, not the ZIP itself.** Keep `.github/workflows/deploy.yml` intact so the deployment workflow is available.

If you have Git installed, the most reliable way is to open a terminal **inside the extracted `mtg-rich-proxy-web` folder** and run (replace the URL with your new repository URL):

```bash
git init
git add .
git commit -m "Initial GitHub Pages website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/mtg-rich-proxy-web.git
git push -u origin main
```

Alternatively, use **GitHub Desktop**: File → Add local repository, create a repository there if prompted, commit, and Publish repository. Make sure to publish the extracted folder, not the surrounding directory.

### 3. Turn on GitHub Pages

1. In the new repository go to **Settings → Pages**.
2. Under **Build and deployment**, select **Source: GitHub Actions**.
3. Navigate to the **Actions** tab. The included workflow (`Test and deploy to GitHub Pages`) tests the JavaScript and publishes the `site/` folder whenever you push to `main`.
4. If the workflow hasn't run since enabling Pages, use **Actions → Test and deploy to GitHub Pages → Run workflow**.
5. When the workflow succeeds, open the URL displayed in the deployment job or **Settings → Pages**.

For a public repository named `mtg-rich-proxy-web` on the `CollinDietz` account, the expected project URL is:

```
https://collindietz.github.io/mtg-rich-proxy-web/
```

GitHub Pages URLs are based on your **actual** account and repository names. The site uses relative paths and works in a project subdirectory.

### 4. Redeploy later

Edit anything inside `site/`, commit and push to `main`. GitHub Actions automatically tests and redeploys. No secrets, tokens, `uv`, package installation, or build configuration are required.

## Run locally (optional)

Opening `site/index.html` using `file://` is **not recommended**: browsers generally restrict JavaScript module imports and CORS from local files. Run a tiny local HTTP server instead.

With Python installed:

```bash
cd mtg-rich-proxy-web
python3 -m http.server 8000 --directory site
```

Open **http://localhost:8000**. On Windows, `python` or `py` can replace `python3`.

Node.js 22+ is only needed **if you want to run the developer tests**, not to host the website:

```bash
npm test
```

## Using the website

1. Paste your decklist in the large input box.
2. Adjust the settings below the text area.
3. Click **Generate PDF**. You'll see matching printings and progress while Scryfall data/images are loaded.
4. The generated PDF downloads automatically, with a second **Download your PDF** button as a backup.
5. When printing: use **US Letter**, **Actual size / 100%**, not “Fit to page.” Disable automatic scaling, and verify one card measures **2.5 × 3.5 inches** before printing a full deck.

### Decklist formats

Minimal list (set and collector are optional):

```text
1x Command Tower
1x Arcane Signet
7x Island
1x Blightstep Pathway // Searstep Pathway (khm) 251
```

Archidekt export (ranking categories and optional foil markers are accepted):

```text
1x Cormela, Glamour Thief (snc) 301 [Commander{top}]
1x Black Mage's Rod (fin) 90 [Wizard Engine A]
1x Past in Flames (who) 565 *F* [Added Recursion A]
1x Reckless Handling (mat) 119 [Removed Tutor B{noDeck}{noPrice},Maybeboard{noDeck}{noPrice}]
1x Faithless Looting [Maybe Draw A{noDeck}{noPrice},Maybeboard{noDeck}{noPrice}]
```

The site **excludes removed, maybeboard, and tokens/extras lines** when they are marked as the primary category or are in a Sideboard/Maybeboard section. An `Added` primary category is treated as an in-deck card. An incidental *secondary* maybeboard category doesn't remove an otherwise-mainboard card. The PDF includes each card as many times as its quantity. A double-faced card produces both faces unless **Front face only** is selected.

### Settings explained

| Setting | Default | What it does |
|---|---|---|
| Cards per sheet | **9** | 9 portrait cards on one US Letter page; 8 and 6 rotate the cards and have gutters. |
| Default printing | **Latest normal** | Newest eligible English paper printing, avoiding special border/treatments. **Most expensive** compares eligible nonfoil USD prices using Scryfall ordering. |
| Artwork treatment | **Standard** | Excludes promo, borderless, showcase, extended-art and (nonbasic) full-art candidates. Change to “Allow special treatments” to include them. |
| Image quality | **Large JPEG** | Smaller PDFs. PNG downloads a higher-resolution original and converts it to high-quality JPEG for PDF embedding. |
| Double-faced cards | **Both faces** | Each front and back appears as a separate printable image. |
| PDF filename | `mtg-rich-proxies.pdf` | Name of the downloaded PDF. |
| Crop marks | **On** | Edge-origin ticks for guillotine trimming. |
| Avoid textless printings | **On** | Excludes printings marked `textless` in Scryfall's metadata. |

**Exact set + collector requests take priority.** If a requested printing is excluded by filters, the site tries another eligible printing (same set first; another set if necessary) and shows a substitution message. If no eligible printing exists, that card fails and **no incomplete PDF is generated**.

**What “latest normal” means:** This is our deterministic selection of the newest *standard-treatment* printing returned by Scryfall, not literally a request to Scryfall's `/cards/named` default image. The results can differ from Scryfall's website-selected art. For *most expensive*, unpriced versions are only used if no eligible priced versions are available.

### Caching

Images are stored locally in **IndexedDB** under keys of the form `printing-id:face:quality`. Different sets/collector numbers have different Scryfall IDs and coexist. Selection records include your name, set, collector and selection settings and expire: **1 day for most-expensive**, **7 days for latest**. Image bytes remain cached until you clear them or the browser evicts them.

Use **Clear cached images** in the page to discard printing selections and artwork. If your browser blocks IndexedDB, the site falls back to an in-memory cache for that page session.

## Technical overview

```text
site/index.html          Responsive UI and all settings
site/styles.css          Custom styling, no CSS framework required
site/js/parser.js        Decklist parser
site/js/scryfall.js      Scryfall API and image downloader
site/js/cache.js         IndexedDB request / artwork cache
site/js/layout.js        6 / 8 / 9 geometry and crop marks
site/js/pdf.js           Dependency-free PDF 1.4 generator
site/js/app.js           UI flow, progress, cancel, download
.github/workflows/deploy.yml  Test + GitHub Pages deployment
package.json             Unit-test command (Node built-ins only)
tests/                   Parser, layout and Scryfall filter tests
```

Scryfall's API is rate-limited; lookup requests are paced and retry transient failures. The browser needs internet access to fetch card metadata and uncached artwork. Some browsers restrict cross-origin image access and IndexedDB, particularly private-browsing contexts; inspect the Activity log if generation fails.

**Known limits:** PDFs are created in browser memory. Very large decks and high-res PNG batches may exhaust the available memory on mobile devices. Most-expensive printing selection uses nonfoil USD, so unpriced promo-only variants aren't prioritized. No print-shop bleed is added; cards stay exact size. Crop marks near paper edges may be clipped by printers with large unprintable margins. A standard inkjet printer may not print 0.5 points from the physical edge; use a print shop or borderless printer if these marks are important.

## Attribution and usage

This is an unofficial fan utility. Card names, artwork and other Magic assets are property of Wizards of the Coast. Card data and artwork URLs are provided by [Scryfall](https://scryfall.com/), whose [API documentation](https://scryfall.com/docs/api) and usage guidance should be respected. This repository's original website code is MIT licensed; that does **not** license the underlying Magic artwork or Scryfall data. The tool is intended for personal playtesting and noncommercial proxy printing, not the sale of counterfeit cards.
