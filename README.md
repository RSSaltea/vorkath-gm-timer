# Vorkath GM Timer

An Alt1 Toolkit plugin for Vorkath Grandmaster carry sessions. It reads the carry queue from a shared Google Sheet and alerts you when you are in the top 3 or when it is your turn.

## Installation

[![Install in Alt1](https://img.shields.io/badge/Install_in-Alt1_Toolkit-c98736?style=for-the-badge&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVDhPY/j//z8DEIMBIwMKwCdJECRBDmBioBIYNRgZkIIYJERNp/7//59BkJuNAUMjAwMDg5+jOQM2jTBNYIkzl+4zCHKxYWrEpgkscebyPQZBbnZMjbg0gSUoAQBZhCEPfNkKxgAAAABJRU5ErkJggg==)](https://rssaltea.github.io/vorkath-gm-timer/install.html)

> Requires [Alt1 Toolkit](https://runeapps.org/alt1) to be installed.

## Features

- **Auto-detects your RS name** from Alt1 — no setup needed.
- **Manual name override** if detection doesn't work.
- **Status tab** — shows your queue position and alerts you when:
  - You enter the top 3 (⚠️ "Get ready!")
  - You reach #1 (🐉 "It's your turn!")
- **Queue tab** — shows the full list with your position highlighted.
- **Audio alerts** — distinct sounds for "get ready" and "your turn".
- **Auto-refreshes** every 10 seconds; manual refresh available.

## Queue data

The plugin reads from:

| Range | Used for |
|-------|----------|
| `List!A2:A4` | Top-3 alert logic |
| `List!A2:A`  | Full queue display |

The spreadsheet must be shared as **"Anyone with the link can view"**.

## Hosting on GitHub Pages

1. Create a repo named `vorkath-gm-timer` on GitHub under your account.
2. Push this folder as the repo root.
3. Enable GitHub Pages (Settings → Pages → Branch: `main`, folder: `/root`).
4. Update the URL in `install.html` to match your GitHub username.

## Notes

- The plugin does **not** modify the spreadsheet — it is read-only.
- Refresh the queue manually any time with the **↻ Refresh** button.
- Name matching is case-insensitive.
