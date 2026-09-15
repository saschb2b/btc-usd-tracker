#!/usr/bin/python3
"""BTC/USD top-bar indicator for Ubuntu's Wayland-compatible AppIndicators."""

import json
import logging
import signal
import threading
import urllib.request
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

REFRESH_SECONDS = 60
NATIVE_BUS_NAME = "io.github.saschb2b.BtcUsdTracker.Popover"
FALLBACK_BUS_NAME = "io.github.saschb2b.BtcUsdTracker.Fallback"
FEEDS = (
    ("Coinbase", "https://api.coinbase.com/v2/prices/BTC-USD/spot"),
    ("Kraken", "https://api.kraken.com/0/public/Ticker?pair=XBTUSD"),
)


def parse_price(source, payload):
    if source == "Coinbase":
        data = payload["data"]
        if data["base"] != "BTC" or data["currency"] != "USD":
            raise ValueError("Unexpected currency pair")
        raw = data["amount"]
    elif source == "Kraken":
        if payload.get("error"):
            raise ValueError("Kraken returned an error")
        raw = payload["result"]["XXBTZUSD"]["c"][0]
    else:
        raise ValueError("Unknown price source")
    try:
        price = Decimal(str(raw))
    except InvalidOperation as exc:
        raise ValueError("Invalid price") from exc
    if not price.is_finite() or price <= 0:
        raise ValueError("Invalid price")
    return price


def fetch_price():
    failures = []
    for source, url in FEEDS:
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "BTC-USD-Tracker/1.1", "Accept": "application/json"}
            )
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = json.loads(response.read(65536))
            return parse_price(source, payload), source
        except Exception as exc:
            failures.append(f"{source}: {exc}")
    raise RuntimeError("; ".join(failures))


def panel_label(price, stale=False):
    if price is None:
        return "BTC offline" if stale else "BTC …"
    return f"${price:,.0f}" + (" *" if stale else "")


def run():
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3, Gio, GLib, Gtk

    try:
        from gi.repository import GLibUnix

        unix_signal_add = GLibUnix.signal_add
    except ImportError:
        # Older GLib typelibs expose signal handling through GLib itself.
        unix_signal_add = GLib.unix_signal_add

    class Tracker:
        def __init__(self):
            self.price = None
            self.busy = False
            self.closed = False
            self.native_present = False
            self.indicator = AyatanaAppIndicator3.Indicator.new(
                "btc-usd-tracker",
                str(Path(__file__).with_name("bitcoin-symbolic.svg")),
                AyatanaAppIndicator3.IndicatorCategory.APPLICATION_STATUS,
            )
            self.indicator.set_title("Bitcoin price in US dollars")
            self.indicator.set_label(panel_label(None), "$000,000 *")
            self.menu = Gtk.Menu()
            self.price_row = self.info("Bitcoin / US Dollar")
            self.source_row = self.info("Source: connecting…")
            self.updated_row = self.info("Waiting for first price")
            self.status_row = self.info("Refreshes every 60 seconds")
            self.menu.append(Gtk.SeparatorMenuItem())
            self.refresh_row = Gtk.MenuItem(label="Refresh now")
            self.refresh_row.connect("activate", lambda _: self.refresh())
            self.menu.append(self.refresh_row)
            quit_row = Gtk.MenuItem(label="Quit until next login")
            quit_row.connect("activate", lambda _: self.quit())
            self.menu.append(quit_row)
            self.menu.show_all()
            self.indicator.set_menu(self.menu)
            self.indicator.set_status(AyatanaAppIndicator3.IndicatorStatus.ACTIVE)
            self.native_watch = Gio.bus_watch_name(
                Gio.BusType.SESSION, NATIVE_BUS_NAME, Gio.BusNameWatcherFlags.NONE,
                lambda *_: self.set_native_present(True),
                lambda *_: self.set_native_present(False),
            )
            self.fallback_name = Gio.bus_own_name(
                Gio.BusType.SESSION, FALLBACK_BUS_NAME, Gio.BusNameOwnerFlags.NONE,
                None, None, None,
            )
            self.timer = GLib.timeout_add_seconds(REFRESH_SECONDS, self.refresh)
            self.refresh()

        def set_native_present(self, present):
            if self.closed or self.native_present == present:
                return
            self.native_present = present
            if not present:
                self.indicator.set_label(panel_label(self.price, stale=self.price is not None), "$000,000 *")
                self.status_row.set_label("Fetching a fresh price…")
            status = (AyatanaAppIndicator3.IndicatorStatus.PASSIVE if present
                      else AyatanaAppIndicator3.IndicatorStatus.ACTIVE)
            self.indicator.set_status(status)
            logging.info("Native popover %s; fallback %s",
                         "available" if present else "unavailable",
                         "hidden" if present else "visible")
            if not present:
                self.refresh()

        def info(self, text):
            item = Gtk.MenuItem(label=text)
            item.set_sensitive(False)
            self.menu.append(item)
            return item

        def refresh(self):
            if self.closed:
                return GLib.SOURCE_REMOVE
            if not self.busy and not self.native_present:
                self.busy = True
                self.refresh_row.set_sensitive(False)
                threading.Thread(target=self.worker, daemon=True).start()
            return GLib.SOURCE_CONTINUE

        def worker(self):
            try:
                price, source = fetch_price()
                GLib.idle_add(self.finish, price, source, None)
            except Exception as exc:
                GLib.idle_add(self.finish, None, None, str(exc))

        def finish(self, price, source, error):
            if self.closed:
                return GLib.SOURCE_REMOVE
            self.busy = False
            self.refresh_row.set_sensitive(True)
            if error:
                logging.warning("Price refresh failed: %s", error)
                self.status_row.set_label("Offline — * marks last known price; retrying every minute")
                self.indicator.set_label(panel_label(self.price, stale=True), "$000,000 *")
            else:
                self.price = price
                self.indicator.set_label(panel_label(price), "$000,000 *")
                self.price_row.set_label(f"1 BTC = ${price:,.2f} USD")
                self.source_row.set_label(f"Source: {source}")
                self.updated_row.set_label(f"Updated: {datetime.now().astimezone():%H:%M:%S %Z}")
                self.status_row.set_label("Refreshes every 60 seconds")
                logging.info("BTC/USD %s via %s", price, source)
            return GLib.SOURCE_REMOVE

        def quit(self):
            self.closed = True
            Gio.bus_unwatch_name(self.native_watch)
            Gio.bus_unown_name(self.fallback_name)
            GLib.source_remove(self.timer)
            self.indicator.set_status(AyatanaAppIndicator3.IndicatorStatus.PASSIVE)
            Gtk.main_quit()
            return GLib.SOURCE_REMOVE

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    tracker = Tracker()
    unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, tracker.quit)
    unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, tracker.quit)
    Gtk.main()


if __name__ == "__main__":
    run()
