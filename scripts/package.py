#!/usr/bin/python3
"""Build the standalone GNOME Shell extension archive."""
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def build_archive(destination):
    source = ROOT / "extension"
    metadata = json.loads((source / "metadata.json").read_text())
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / f'{metadata["uuid"]}.shell-extension.zip'
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ("metadata.json", "extension.js", "client.js", "data.js", "stylesheet.css"):
            archive.write(source / name, name)
        for name in ("bitcoin-symbolic.svg", "LICENSE", "LICENSE.bitcoin-icons", "NOTICE.md"):
            archive.write(ROOT / name, name)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    print(build_archive(parser.parse_args().output))
