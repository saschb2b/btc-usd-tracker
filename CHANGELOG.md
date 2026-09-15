# Changelog

## 1.1.0 — 2026-09-15

- Native GNOME 50 popover with separate Market and Network tabs on Wayland.
- Kraken 1-hour, 24-hour, and 7-day price charts, chart inspection, period change,
  high/low, rolling 24-hour volume, and satoshis per dollar.
- mempool.space fee estimates, five projected blocks, latest block age, and queue statistics.
- Native quotes use Kraken with Coinbase fallback; each dataset preserves and marks stale data.
- Automatic standalone fallback: hides and pauses when the popover runs, resumes when it stops.
- One-click switch to the simple indicator from the popover.
- `--with-popover` installation, extension updates/removal, and standalone extension ZIP packaging.
- Original Bitcoin Design Community artwork retained in both modes.
- GJS data tests, packaging/installer tests, and a GNOME 50 headless Wayland smoke test.
- Actual popover screenshots and installation/troubleshooting documentation.

## 1.0.0 — 2026-09-15

- BTC/USD top-bar indicator, verified on Ubuntu 26.04 with GNOME 50 and Wayland.
- Automatic refresh every minute, Coinbase quotes, and Kraken fallback.
- Price details, update timestamp, manual refresh, and offline status.
- User-only installer, systemd startup, upgrades, and uninstaller.
- Bitcoin Design Community artwork, with provenance and license notice.
- Tests for provider responses, fallback, stale labels, and installation behavior.
