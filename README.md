# BTC/USD Tracker

[![CI](https://github.com/saschb2b/btc-usd-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/saschb2b/btc-usd-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Desktop: Ubuntu · Wayland](https://img.shields.io/badge/desktop-Ubuntu%20%C2%B7%20Wayland-E95420)](#compatibility)

**Bitcoin's dollar price, right in your Ubuntu top bar.**

A small Python indicator that brings back the always-visible BTC/USD ticker on
modern Ubuntu. It uses Ubuntu's AppIndicators support, works on Wayland, and
starts with your desktop session.

![Illustration of the Bitcoin indicator and its price menu](docs/preview.svg)

*Illustrative preview with sample prices. The Bitcoin artwork comes from the
[Bitcoin Design Community](NOTICE.md).*

## What it does

- Shows the Bitcoin symbol and the rounded USD price in the top-right bar.
- Refreshes every **60 seconds**, with a **Refresh now** menu item.
- Uses **Coinbase**, with **Kraken** as a fallback. No account or API key needed.
- Shows the full price, source, and last update time when clicked.
- Marks the last known price with `*` if both feeds fail and retries automatically.
- Starts at login and stops with your desktop session.

Network requests run in a background thread so the menu stays responsive.
The app uses Python's standard library plus the desktop libraries supplied by Ubuntu.

## Quick start

### 1. Install the desktop libraries

On Ubuntu:

```bash
sudo apt update
sudo apt install git python3-gi gir1.2-gtk-3.0 gir1.2-ayatanaappindicator3-0.1
```

Ubuntu normally includes the **Ubuntu AppIndicators** extension. Check that it is active:

```bash
gnome-extensions info ubuntu-appindicators@ubuntu.com
```

If it is installed but disabled:

```bash
gnome-extensions enable ubuntu-appindicators@ubuntu.com
```

For other GNOME installations, see [compatibility](#compatibility).

### 2. Install the tracker

Run these commands in a terminal inside your desktop session:

```bash
git clone https://github.com/saschb2b/btc-usd-tracker.git
cd btc-usd-tracker
./install.sh
```

Run the installer **as your normal user, without `sudo`**. It copies the app to
your user data directory, installs a systemd user service, enables startup at
login, and starts the tracker immediately. No desktop restart is needed when
AppIndicators is already active.

To install and enable startup without starting it immediately:

```bash
./install.sh --no-start
```

## Using it

Click the indicator to see the price with cents, the active feed, and the time of
the last successful update. Choose **Refresh now** to fetch a fresh quote or
**Quit until next login** to hide it for the rest of your session.

| Display | Meaning |
| --- | --- |
| `$76,920` | Last successful quote, rounded to whole dollars |
| `$76,920 *` | The next refresh failed; the previous price is still shown |
| `BTC offline` | Neither feed is reachable and no price has been fetched yet |

Quotes are requested once per minute. Coinbase and Kraken can quote slightly
different prices. This is a display-only app; it has no wallet or trading features.

## Update or remove

From your clone:

```bash
# Update and restart
git pull --ff-only
./install.sh

# Stop, disable startup, and remove installed app files
./uninstall.sh
```

Uninstalling leaves your repository clone and any unrelated files in place.

Useful service commands:

```bash
# Status and recent logs
systemctl --user status btc-usd-tracker.service
journalctl --user -u btc-usd-tracker.service -n 20

# Stop and disable startup
systemctl --user disable --now btc-usd-tracker.service

# Re-enable and start
systemctl --user enable --now btc-usd-tracker.service
```

## Compatibility

**Verified:** Ubuntu 26.04 LTS, GNOME Shell 50, Wayland.

The app requires Python 3.10+, PyGObject, GTK 3, Ayatana AppIndicator 3, a desktop
that displays AppIndicators, and systemd user services for the installer.
GTK selects Wayland when available, with X11 as a fallback.

Other GNOME desktops need the
[AppIndicator and KStatusNotifierItem Support extension](https://github.com/ubuntu/gnome-shell-extension-appindicator).
Other distributions and desktop versions have not been verified by this project.

The app deliberately runs outside GNOME Shell and uses the desktop's existing
indicator extension to display its icon and label.

### Install locations

| Item | Default location |
| --- | --- |
| App and artwork | `~/.local/share/btc-usd-tracker/` |
| Service | `~/.config/systemd/user/btc-usd-tracker.service` |

The installer respects `XDG_DATA_HOME` and `XDG_CONFIG_HOME`. Use the same values
when installing, updating, or uninstalling.

## Troubleshooting

**The service runs, but there is no icon.** Check that your AppIndicator extension
is active. A newly installed GNOME extension may need a logout/login before it
can load on Wayland.

**The menu says offline or the price has an asterisk.** Check your connection and
the service logs. The tracker tries both providers on every refresh and recovers
automatically when one becomes available.

**`systemctl --user` cannot connect to the bus, or GTK cannot open a display.**
Run the installer from your logged-in graphical desktop as your normal user.
It is not intended for root, a container, or a headless SSH session.

**A desktop library is missing.** Install the packages in the quick start using
APT. The launcher uses `/usr/bin/python3` so it can see Ubuntu's system libraries.

**A deprecation notice mentions `libayatana-appindicator`.** The Ubuntu 26.04
library emits this notice. The indicator still works; migration to the newer
GLib-based API is a future compatibility task.

## Development

The parsing, fallback, formatting, and installer tests run without network access
or desktop libraries:

```bash
python3 -m unittest discover -s tests -v
```

CI runs them on Python 3.10 through 3.14. For a desktop smoke test, use
`./install.sh`, check the menu, wait for an automatic refresh, then inspect the
service logs. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Data sources and credits

- [Coinbase spot-price API](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices)
- [Kraken public API examples](https://support.kraken.com/en-es/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-)
- [Ubuntu AppIndicators](https://github.com/ubuntu/gnome-shell-extension-appindicator)
- [Bitcoin Design Community's Bitcoin Icons](https://github.com/BitcoinDesign/Bitcoin-Icons)

The app sends public price requests directly to Coinbase and, on failure, Kraken.
It stores no price history and includes no analytics. Successful quotes and
request errors are recorded in the local systemd journal.

Code: [MIT](LICENSE). Bitcoin artwork: [public domain, with upstream attribution](NOTICE.md).
