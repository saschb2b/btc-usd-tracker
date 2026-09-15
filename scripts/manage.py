#!/usr/bin/python3
"""Install or remove the tracker for the current desktop user."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SERVICE = "btc-usd-tracker.service"
EXTENSION_UUID = "btc-usd-tracker@saschb2b.github.io"
EXTENSION_FILES = ("metadata.json", "extension.js", "client.js", "data.js", "stylesheet.css")
ARTWORK_FILES = ("bitcoin-symbolic.svg", "LICENSE", "LICENSE.bitcoin-icons", "NOTICE.md")
APP_FILES = (
    "tracker.py", "bitcoin-symbolic.svg", "LICENSE", "LICENSE.bitcoin-icons", "README.md", "NOTICE.md",
)


def install_paths():
    data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
    config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    if not data.is_absolute() or not config.is_absolute():
        raise ValueError("XDG_DATA_HOME and XDG_CONFIG_HOME must be absolute paths")
    return data / "btc-usd-tracker", config / "systemd/user" / SERVICE


def systemctl(*args):
    subprocess.run(["systemctl", "--user", *args], check=True)


def check_dependencies():
    if not shutil.which("systemctl"):
        raise RuntimeError("This installer requires systemd user services")
    try:
        import gi

        gi.require_version("Gtk", "3.0")
        gi.require_version("AyatanaAppIndicator3", "0.1")
        from gi.repository import AyatanaAppIndicator3, Gtk  # noqa: F401
    except (ImportError, ValueError) as exc:
        raise RuntimeError(
            "Missing desktop libraries. On Ubuntu, run:\n"
            "  sudo apt install python3-gi gir1.2-gtk-3.0 "
            "gir1.2-ayatanaappindicator3-0.1\n"
            "Then run ./install.sh again as your normal user."
        ) from exc


def systemd_argument(path):
    value = str(path)
    if any(c in value for c in "\n\r\x00"):
        raise ValueError("Installation paths cannot contain newlines or NUL bytes")
    # Escape both unit specifiers and ExecStart environment substitution.
    value = value.replace("\\", "\\\\").replace('"', '\\"')
    value = value.replace("%", "%%").replace("$", "$$")
    return f'"{value}"'


def extension_path():
    app_dir, _ = install_paths()
    return app_dir.parent / "gnome-shell/extensions" / EXTENSION_UUID


def set_extension_enabled(enabled):
    from gi.repository import Gio

    settings = Gio.Settings.new("org.gnome.shell")
    extensions = [item for item in settings.get_strv("enabled-extensions") if item != EXTENSION_UUID]
    if enabled:
        extensions.append(EXTENSION_UUID)
        disabled = [item for item in settings.get_strv("disabled-extensions") if item != EXTENSION_UUID]
        settings.set_strv("disabled-extensions", disabled)
    settings.set_strv("enabled-extensions", extensions)
    Gio.Settings.sync()


def install_extension(enable):
    destination = extension_path()
    destination.mkdir(parents=True, exist_ok=True)
    for name in EXTENSION_FILES:
        shutil.copy2(ROOT / "extension" / name, destination / name)
    for name in ARTWORK_FILES:
        shutil.copy2(ROOT / name, destination / name)
    if enable:
        set_extension_enabled(True)
    print(f"Installed GNOME popover to {destination}")
    print("A new or updated local extension needs logout/login to load its code.")
    print("The simple indicator stays available until the popover is running.")


def install(no_start=False, with_popover=False):
    check_dependencies()
    app_dir, unit_path = install_paths()
    template = (ROOT / "packaging" / f"{SERVICE}.in").read_text()
    unit = template.replace("@TRACKER_PATH@", systemd_argument(app_dir / "tracker.py"))
    app_dir.mkdir(parents=True, exist_ok=True)
    unit_path.parent.mkdir(parents=True, exist_ok=True)
    for filename in APP_FILES:
        shutil.copy2(ROOT / filename, app_dir / filename)
    unit_path.write_text(unit)
    systemctl("daemon-reload")
    systemctl("enable", SERVICE)
    if not no_start:
        # restart also starts an inactive service and applies upgrades immediately.
        systemctl("restart", SERVICE)
    if with_popover or extension_path().exists():
        install_extension(enable=with_popover and not no_start)
    print(f"Installed to {app_dir}")
    print("Automatic startup enabled for graphical desktop sessions.")
    if no_start:
        print(f"Start it with: systemctl --user start {SERVICE}")
    else:
        print("Look for the Bitcoin symbol and USD price in your top bar.")
        print(f"Check startup with: systemctl --user status {SERVICE}")


def uninstall():
    app_dir, unit_path = install_paths()
    extension_dir = extension_path()
    if not unit_path.exists() and not app_dir.exists() and not extension_dir.exists():
        print("The tracker is not installed.")
        return
    if unit_path.exists():
        systemctl("disable", "--now", SERVICE)
    if extension_dir.exists():
        set_extension_enabled(False)
        for filename in EXTENSION_FILES + ARTWORK_FILES:
            (extension_dir / filename).unlink(missing_ok=True)
        try:
            extension_dir.rmdir()
        except OSError:
            print(f"Kept additional files in {extension_dir}")
    unit_path.unlink(missing_ok=True)
    # Remove only files this installer owns; leave unrelated files in place.
    for filename in APP_FILES:
        (app_dir / filename).unlink(missing_ok=True)
    if app_dir.exists():
        try:
            app_dir.rmdir()
        except OSError:
            print(f"Kept additional files in {app_dir}")
    systemctl("daemon-reload")
    print("Tracker removed; automatic startup disabled.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    installer = commands.add_parser("install", help="Install or upgrade the tracker")
    installer.add_argument("--no-start", action="store_true", help="Enable startup but do not start now")
    installer.add_argument("--with-popover", action="store_true", help="Also install the GNOME 50 popover")
    commands.add_parser("uninstall", help="Stop and remove the tracker")
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error("Run this as your normal desktop user, without sudo")
    try:
        if args.command == "install":
            install(args.no_start, args.with_popover)
        else:
            uninstall()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
