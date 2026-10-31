import importlib.util
import json
import os
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG = ROOT / "build/appstore/catalog.json"
os.environ["APPSTORE_CATALOG"] = str(CATALOG)

spec = importlib.util.spec_from_file_location(
    "appstore_daemon", ROOT / "build/appstore/appstore-daemon.py"
)
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class CatalogTests(unittest.TestCase):
    def test_catalog_entries_are_safe_and_unique(self):
        apps = json.loads(CATALOG.read_text())
        ids = [app["id"] for app in apps]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(app["id"] in store.ALLOWED for app in apps))
        self.assertFalse(set(ids) & store.PROTECTED)
        for app in apps:
            self.assertGreater(app["size_mb"], 0)
            self.assertIn(app["category"], {"System", "Files", "Utilities"})

    def test_progress_parser_reads_apk_lines(self):
        self.assertAlmostEqual(store.parse_progress("(2/4) Installing htop"), 0.5)
        self.assertAlmostEqual(store.parse_progress("(3/3) Purging htop"), 1.0)
        self.assertIsNone(store.parse_progress("fetch https://example.invalid"))

    def test_catalog_payload_marks_installed_and_free_space(self):
        original_installed = store.installed_packages
        original_free = store.free_bytes
        original_exists = os.path.exists
        try:
            store.installed_packages = lambda: {"htop", "nano"}
            store.free_bytes = lambda: 123 * 1024 * 1024
            os.path.exists = lambda path: True
            payload = store.catalog_payload()
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["free_mb"], 123.0)
            by_id = {app["id"]: app for app in payload["apps"]}
            self.assertTrue(by_id["htop"]["installed"])
            self.assertTrue(by_id["nano"]["installed"])
            self.assertFalse(by_id["mc"]["installed"])
        finally:
            store.installed_packages = original_installed
            store.free_bytes = original_free
            os.path.exists = original_exists


class GuiTests(unittest.TestCase):
    def test_gui_compiles(self):
        source = (ROOT / "build/appstore/appstore-gui.py").read_text()
        compile(source, "appstore-gui.py", "exec")


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.original_installed = store.installed_packages
        self.original_free = store.free_bytes
        self.original_thread = store.threading.Thread
        self.original_run_job = store.run_job
        store.installed_packages = lambda: set()
        store.free_bytes = lambda: 200 * 1024 * 1024

        class NoopThread:
            def __init__(self, *args, **kwargs):
                pass

            def start(self):
                pass

        store.threading.Thread = NoopThread
        store.run_job = lambda *args: None
        with store.JOB_LOCK:
            store.JOB.clear()
            store.JOB.update({"state": "idle"})

    def tearDown(self):
        store.installed_packages = self.original_installed
        store.free_bytes = self.original_free
        store.threading.Thread = self.original_thread
        store.run_job = self.original_run_job
        with store.JOB_LOCK:
            store.JOB.clear()
            store.JOB.update({"state": "idle"})

    def test_protected_and_unknown_packages_are_rejected(self):
        self.assertFalse(store.handle_request({"cmd": "install", "id": "xfce4"})["ok"])
        self.assertFalse(store.handle_request({"cmd": "install", "id": "not-a-package"})["ok"])
        self.assertFalse(store.handle_request({"cmd": "remove", "id": "htop"})["ok"])

    def test_allowlisted_install_is_accepted(self):
        result = store.handle_request({"cmd": "install", "id": "htop"})
        self.assertTrue(result["ok"])

    def test_unknown_command_is_rejected(self):
        self.assertFalse(store.handle_request({"cmd": "run-shell"})["ok"])


if __name__ == "__main__":
    unittest.main()
