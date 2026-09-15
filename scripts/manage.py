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


def install(no_start=False):
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
    print(f"Installed to {app_dir}")
    print("Automatic startup enabled for graphical desktop sessions.")
    if no_start:
        print(f"Start it with: systemctl --user start {SERVICE}")
    else:
        print("Look for the Bitcoin symbol and USD price in your top bar.")
        print(f"Check startup with: systemctl --user status {SERVICE}")


def uninstall():
    app_dir, unit_path = install_paths()
    if not unit_path.exists() and not app_dir.exists():
        print("The tracker is not installed.")
        return
    systemctl("disable", "--now", SERVICE)
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
    commands.add_parser("uninstall", help="Stop and remove the tracker")
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error("Run this as your normal desktop user, without sudo")
    try:
        if args.command == "install":
            install(args.no_start)
        else:
            uninstall()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
