import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.package import ROOT, build_archive


class PackageTests(unittest.TestCase):
    def test_extension_archive_includes_community_icon_and_all_modules(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = build_archive(Path(folder))
            with zipfile.ZipFile(archive) as package:
                self.assertEqual(set(package.namelist()), {
                    "metadata.json", "extension.js", "client.js", "data.js", "stylesheet.css",
                    "bitcoin-symbolic.svg", "LICENSE", "LICENSE.bitcoin-icons", "NOTICE.md",
                })
                self.assertEqual(package.read("bitcoin-symbolic.svg"), (ROOT / "bitcoin-symbolic.svg").read_bytes())
                metadata = json.loads(package.read("metadata.json"))
                self.assertEqual(metadata["shell-version"], ["50"])
                self.assertEqual(archive.name, metadata["uuid"] + ".shell-extension.zip")
