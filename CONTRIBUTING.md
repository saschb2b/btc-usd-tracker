# Contributing

Bug reports and focused pull requests are welcome.

## Run the tests

```bash
python3 -m unittest discover -s tests -v
```

Tests use fake price responses and temporary install directories. They do not
contact price providers or change the running desktop service.

## Desktop smoke test

On a desktop with GTK 3, PyGObject, Ayatana AppIndicator, and indicator support:

1. Run `./install.sh` as your normal user. This installs or updates your local tracker.
2. Confirm that the icon and price appear and the menu opens.
3. Try **Refresh now**, then wait at least 60 seconds for an automatic update.
4. Check `journalctl --user -u btc-usd-tracker.service -n 20` for errors.
5. Check stopping and restarting with `systemctl --user restart btc-usd-tracker.service`.
6. If changing lifecycle behavior, also check **Quit until next login** and a new login.

Please report the distribution, GNOME version, session type (Wayland/X11), and
relevant logs when reporting desktop-specific problems. Review logs before posting.

## Keep it small

The project focuses on one always-visible BTC/USD price. Keep HTTP work off the
GTK thread, validate provider data, mark stale quotes, and preserve the fallback
when changing networking code. Avoid adding API keys or accounts for basic use.

The Bitcoin symbol is upstream community artwork. Preserve its geometry and
update `NOTICE.md` if changing the source or version of any third-party asset.
