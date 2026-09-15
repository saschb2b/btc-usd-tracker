# Contributing

Bug reports and focused pull requests are welcome.

## Tests and packaging

```bash
python3 -m unittest discover -s tests -v
gjs -m tests/test_data.js
python3 scripts/package.py
```

The tests use fake provider responses and temporary install directories. They do
not contact data providers or change your desktop settings or running service.
The packaging script writes a native GNOME extension ZIP to `dist/`.

## Isolated GNOME smoke test

GNOME 50 supplies `gnome-shell-test-tool`. The following opt-in test launches its
own headless Wayland shell and D-Bus session, with temporary extension settings.
It uses **live public APIs** and needs GNOME 50, GJS, Soup 3, and the Python desktop
libraries listed in the README. It does not install anything in your live session.

```bash
python3 scripts/package.py
mkdir -p dist/screenshots
BTC_TEST_SOURCE="$PWD" \
BTC_TEST_OUTPUT="$PWD/dist/screenshots" \
LIBGL_ALWAYS_SOFTWARE=1 \
dbus-run-session -- gnome-shell-test-tool --headless \
  --extension "$PWD/dist/btc-usd-tracker@saschb2b.github.io.shell-extension.zip" \
  "$PWD/tests/gnome_smoke.js"
```

Look for `BTC_SMOKE_PASSED` and a successful exit. It checks:

- Quote, all three chart ranges, and network data load in the real shell UI.
- Failed refreshes preserve and mark the previous quote, chart, and network data.
- The standalone indicator becomes passive when the native popover is active.
- **Use simple indicator** disables the extension and makes the fallback active.
- Re-enabling the extension hides the fallback again.
- An old pending request cannot overwrite a newly enabled extension's state.

The test captures both popover tabs in `dist/screenshots/`. Omit `BTC_TEST_OUTPUT`
to skip screenshots. Provider outages can fail this live test; it is separate from
the deterministic unit tests in CI.

## Check the live desktop

1. Run `./install.sh --with-popover` as your normal desktop user.
2. Verify the simple indicator is visible, then log out/in to load the extension.
3. Try both tabs, all ranges, chart hover, keyboard focus, and **Refresh now**.
4. Choose **Use simple indicator**, verify its price menu, then restore the native
   extension with `gnome-extensions enable btc-usd-tracker@saschb2b.github.io`.
5. Check startup after a new login, and test updates/uninstall if changing the installer.

Please report the distribution, GNOME version, session type (Wayland/X11), and
relevant logs when reporting desktop-specific problems. Review logs before posting.

## Design constraints

Keep the top bar compact and the popover readable. Keep HTTP work asynchronous,
validate provider data, mark stale datasets, cancel work on extension disable, and
preserve the independent indicator fallback. Do not add accounts or API keys for
basic use. Raise supported GNOME versions only after testing their shell APIs.

The Bitcoin symbol is upstream community artwork. Preserve its geometry and
update `NOTICE.md` if changing the source or version of any third-party asset.
