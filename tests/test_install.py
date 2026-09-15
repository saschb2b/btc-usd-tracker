import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import call, patch

from scripts import manage


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / 'a path with spaces % $ and "quotes"'
        self.environment = patch.dict(os.environ, {
            "XDG_DATA_HOME": str(self.base / "data"),
            "XDG_CONFIG_HOME": str(self.base / "config"),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.commands = patch.object(manage, "systemctl")
        self.systemctl = self.commands.start()
        self.addCleanup(self.commands.stop)
        dependencies = patch.object(manage, "check_dependencies")
        dependencies.start()
        self.addCleanup(dependencies.stop)
        output = contextlib.redirect_stdout(io.StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)

    def test_install_and_upgrade(self):
        manage.install()
        app_dir, unit_path = manage.install_paths()
        for filename in manage.APP_FILES:
            self.assertEqual((app_dir / filename).read_bytes(), (manage.ROOT / filename).read_bytes())
        unit = unit_path.read_text()
        self.assertIn('%% $$ and \\"quotes\\"', unit)
        self.assertIn('ExecStart=/usr/bin/python3 "', unit)
        self.assertNotIn("@TRACKER_PATH@", unit)
        self.assertEqual(self.systemctl.call_args_list, [
            call("daemon-reload"), call("enable", manage.SERVICE), call("restart", manage.SERVICE),
        ])
        (app_dir / "tracker.py").write_text("old installation")
        manage.install()
        self.assertEqual((app_dir / "tracker.py").read_bytes(), (manage.ROOT / "tracker.py").read_bytes())

    def test_no_start_installs_without_starting_service(self):
        manage.install(no_start=True)
        self.assertEqual(self.systemctl.call_args_list, [
            call("daemon-reload"), call("enable", manage.SERVICE),
        ])

    def test_uninstall_removes_owned_files(self):
        manage.install(no_start=True)
        app_dir, unit_path = manage.install_paths()
        self.systemctl.reset_mock()
        manage.uninstall()
        self.assertFalse(app_dir.exists())
        self.assertFalse(unit_path.exists())
        self.assertEqual(self.systemctl.call_args_list, [
            call("disable", "--now", manage.SERVICE), call("daemon-reload"),
        ])

    def test_uninstall_preserves_unrelated_files(self):
        manage.install(no_start=True)
        app_dir, _ = manage.install_paths()
        unrelated = app_dir / "my-notes.txt"
        unrelated.write_text("keep this")
        manage.uninstall()
        self.assertEqual(unrelated.read_text(), "keep this")
        self.assertFalse((app_dir / "tracker.py").exists())

    def test_uninstall_when_absent(self):
        manage.uninstall()
        self.systemctl.assert_not_called()

    def test_relative_xdg_path_is_rejected(self):
        with patch.dict(os.environ, {"XDG_DATA_HOME": "relative"}):
            with self.assertRaisesRegex(ValueError, "absolute"):
                manage.install_paths()

    def test_newline_path_is_rejected(self):
        with self.assertRaises(ValueError):
            manage.systemd_argument("/tmp/bad\npath")


if __name__ == "__main__":
    unittest.main()
