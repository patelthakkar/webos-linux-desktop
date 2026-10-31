#!/usr/bin/env python3
"""GTK front end for the small on-desktop App Store."""
import json
import socket
import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

SOCKET_PATH = "/run/appstore.sock"
SOCKET_TIMEOUT = 10

CSS = b"""
window { background-color: #0d100f; color: #eee7d7; }
.header-title { font-size: 26px; font-weight: bold; }
.header-sub { color: #b9b2a3; font-size: 15px; }
.app-name { font-size: 19px; font-weight: bold; }
.app-summary { color: #b9b2a3; font-size: 15px; }
.app-meta { color: #b9b2a3; font-size: 13px; }
.free { color: #b9b2a3; font-size: 13px; }
.status { color: #b9b2a3; font-size: 15px; }
.error { color: #d98578; }
entry { background-color: #121715; color: #eee7d7; border: 1px solid rgba(238,231,215,0.25); border-radius: 3px; padding: 9px 12px; }
button { border-radius: 3px; padding: 8px 16px; }
button.suggested { background-image: none; background-color: #eee7d7; color: #0d100f; border: 0; box-shadow: none; }
button.destructive { background-image: none; background-color: transparent; color: #d98578; border: 1px solid rgba(217,133,120,0.5); box-shadow: none; }
button:disabled { opacity: 0.45; }
list { background-color: #0d100f; }
row { border-bottom: 1px solid rgba(238,231,215,0.12); }
"""


class Client:
    def request(self, payload):
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
                sock.settimeout(SOCKET_TIMEOUT)
                sock.connect(SOCKET_PATH)
                sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
                data = b""
                while b"\n" not in data:
                    chunk = sock.recv(65536)
                    if not chunk:
                        break
                    data += chunk
        except (ConnectionError, FileNotFoundError, TimeoutError) as error:
            raise RuntimeError("The package service is not running. Restart the desktop and try again.") from error
        except OSError as error:
            raise RuntimeError("The package service is unavailable.") from error
        try:
            return json.loads(data.split(b"\n", 1)[0].decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as error:
            raise RuntimeError("The package service returned an invalid response.") from error


class StoreWindow(Gtk.Window):
    def __init__(self):
        super().__init__(title="App Store")
        self.set_default_size(1000, 650)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_icon_name("system-software-install")
        self.set_decorated(False)
        self.client = Client()
        self.apps = []
        self.rows = []
        self.buttons = []
        self.busy = False
        self.active_id = None
        self.active_action = None
        self.poll_source = None
        self.refresh_button = None
        self._build()
        self.refresh()

    def _build(self):
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(
            self.get_screen(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.add(outer)

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        header.set_border_width(22)
        title_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
        title = Gtk.Label(xalign=0, label="App Store")
        title.get_style_context().add_class("header-title")
        subtitle = Gtk.Label(xalign=0, label="Small, signed packages for this desktop.")
        subtitle.get_style_context().add_class("header-sub")
        title_box.pack_start(title, False, False, 0)
        title_box.pack_start(subtitle, False, False, 0)
        header.pack_start(title_box, True, True, 0)
        close = Gtk.Button(label="Close")
        close.connect("clicked", lambda _button: self.destroy())
        header.pack_end(close, False, False, 0)
        outer.pack_start(header, False, False, 0)

        search = Gtk.SearchEntry()
        search.set_placeholder_text("Search apps")
        search.set_margin_start(22)
        search.set_margin_end(22)
        search.set_margin_bottom(14)
        search.connect("search-changed", self.render_rows)
        self.search = search
        outer.pack_start(search, False, False, 0)

        scroller = Gtk.ScrolledWindow()
        scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroller.set_vexpand(True)
        self.listbox = Gtk.ListBox()
        self.listbox.set_selection_mode(Gtk.SelectionMode.NONE)
        scroller.add(self.listbox)
        outer.pack_start(scroller, True, True, 0)

        footer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        footer.set_border_width(16)
        line = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.status = Gtk.Label(xalign=0, label="Loading…")
        self.status.get_style_context().add_class("status")
        self.status.set_line_wrap(True)
        self.status.set_max_width_chars(80)
        line.pack_start(self.status, True, True, 0)
        self.free = Gtk.Label(xalign=1, label="")
        self.free.get_style_context().add_class("free")
        line.pack_end(self.free, False, False, 0)
        footer.pack_start(line, False, False, 0)

        progress_line = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.progress = Gtk.ProgressBar()
        self.progress.set_vexpand(False)
        self.progress.set_size_request(-1, 6)
        progress_line.pack_start(self.progress, True, True, 0)
        self.retry = Gtk.Button(label="Retry")
        self.retry.set_no_show_all(True)
        self.retry.connect("clicked", lambda _button: self.refresh())
        progress_line.pack_end(self.retry, False, False, 0)
        footer.pack_start(progress_line, False, False, 0)
        outer.pack_end(footer, False, False, 0)

    def refresh(self):
        self.retry.hide()
        try:
            response = self.client.request({"cmd": "catalog"})
        except RuntimeError as error:
            self.show_unavailable(str(error))
            return
        if not response.get("ok"):
            self.show_unavailable(response.get("error", "The catalog could not be loaded."))
            return
        self.apps = response.get("apps", [])
        self.free.set_text(f"{response.get('free_mb', 0):.0f} MB free")
        self.status.set_text("Select an app to install or remove.")
        self.status.get_style_context().remove_class("error")
        self.render_rows()
        self.check_running_job()

    def show_unavailable(self, message):
        self.apps = []
        self.render_rows()
        self.status.set_text(message)
        self.status.get_style_context().add_class("error")
        self.free.set_text("")
        self.retry.show()

    def render_rows(self, *_args):
        for row in list(self.rows):
            self.listbox.remove(row)
        self.rows = []
        self.buttons = []
        query = self.search.get_text().strip().lower() if hasattr(self, "search") else ""
        visible = [
            app for app in self.apps
            if not query or query in f"{app['name']} {app['summary']} {app['category']}".lower()
        ]
        if not visible:
            empty = Gtk.ListBoxRow()
            empty.set_activatable(False)
            label = Gtk.Label(xalign=0, label="No apps match that search.")
            label.get_style_context().add_class("status")
            label.set_border_width(22)
            empty.add(label)
            empty.show_all()
            self.listbox.add(empty)
            self.rows.append(empty)
            return
        for app in visible:
            self.rows.append(self.make_row(app))

    def make_row(self, app):
        row = Gtk.ListBoxRow()
        row.set_activatable(False)
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        box.set_border_width(16)
        text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        name = Gtk.Label(xalign=0, label=app["name"])
        name.get_style_context().add_class("app-name")
        summary = Gtk.Label(xalign=0, label=app["summary"])
        summary.get_style_context().add_class("app-summary")
        summary.set_line_wrap(True)
        summary.set_max_width_chars(74)
        meta = Gtk.Label(
            xalign=0,
            label=f"{app['category']} · {app['size_mb']} MB installed",
        )
        meta.get_style_context().add_class("app-meta")
        text.pack_start(name, False, False, 0)
        text.pack_start(summary, False, False, 0)
        text.pack_start(meta, False, False, 0)
        box.pack_start(text, True, True, 0)

        button = Gtk.Button(label="Remove" if app["installed"] else "Install")
        button.set_valign(Gtk.Align.CENTER)
        if app["installed"]:
            button.get_style_context().add_class("destructive")
        else:
            button.get_style_context().add_class("suggested")
        button.set_sensitive(not self.busy)
        button.connect("clicked", self.on_action, app)
        box.pack_end(button, False, False, 0)
        self.buttons.append(button)
        row.add(box)
        row.show_all()
        self.listbox.add(row)
        return row

    def set_busy(self, busy):
        self.busy = busy
        for button in self.buttons:
            button.set_sensitive(not busy)

    def on_action(self, _button, app):
        if self.busy:
            return
        action = "remove" if app["installed"] else "install"
        if action == "remove":
            dialog = Gtk.MessageDialog(
                transient_for=self,
                flags=0,
                message_type=Gtk.MessageType.QUESTION,
                buttons=Gtk.ButtonsType.NONE,
                text=f"Remove {app['name']}?",
            )
            dialog.format_secondary_text("The app will be removed. Files in /home/desk are kept.")
            dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
            remove = dialog.add_button("Remove", Gtk.ResponseType.OK)
            remove.get_style_context().add_class("destructive")
            response = dialog.run()
            dialog.destroy()
            if response != Gtk.ResponseType.OK:
                return
        try:
            result = self.client.request({"cmd": action, "id": app["id"]})
        except RuntimeError as error:
            self.show_error(str(error))
            return
        if not result.get("ok"):
            self.show_error(result.get("error", "The request was rejected."))
            return
        self.active_id = app["id"]
        self.active_action = action
        self.set_busy(True)
        self.progress.set_fraction(0)
        self.status.set_text(f"{'Installing' if action == 'install' else 'Removing'} {app['name']}…")
        self.status.get_style_context().remove_class("error")
        self.poll_source = GLib.timeout_add(400, self.poll_job)

    def poll_job(self):
        if not self.busy:
            self.poll_source = None
            return False
        try:
            response = self.client.request({"cmd": "status"})
        except RuntimeError as error:
            self.finish_job()
            self.show_error(str(error))
            return False
        if not response.get("ok"):
            self.finish_job()
            self.show_error(response.get("error", "The package service returned an error."))
            return False
        job = response.get("job", {})
        state = job.get("state")
        if state == "running":
            self.status.set_text(job.get("message", "Working…"))
            progress = job.get("progress", 0)
            if progress:
                self.progress.set_fraction(min(max(float(progress), 0), 1))
            else:
                self.progress.pulse()
            return True
        if state == "error":
            message = job.get("message", "The package operation failed.")
            self.finish_job()
            self.refresh_after_job()
            self.show_error(message)
            return False
        if state == "done":
            message = job.get("message", "Finished.")
            self.finish_job()
            self.refresh_after_job(message)
            return False
        self.finish_job()
        self.refresh_after_job()
        return False

    def check_running_job(self):
        try:
            response = self.client.request({"cmd": "status"})
        except RuntimeError:
            return
        job = response.get("job", {}) if response.get("ok") else {}
        if job.get("state") == "running":
            self.active_id = job.get("id")
            self.active_action = job.get("action")
            self.set_busy(True)
            self.status.set_text(job.get("message", "Working…"))
            self.poll_source = GLib.timeout_add(400, self.poll_job)

    def finish_job(self):
        if self.poll_source:
            GLib.source_remove(self.poll_source)
            self.poll_source = None
        self.progress.set_fraction(0)
        self.set_busy(False)

    def refresh_after_job(self, message=None):
        self.refresh()
        if message:
            self.status.set_text(message)

    def show_error(self, message):
        dialog = Gtk.MessageDialog(
            transient_for=self,
            flags=0,
            message_type=Gtk.MessageType.ERROR,
            buttons=Gtk.ButtonsType.CLOSE,
            text="App Store could not finish that request.",
        )
        dialog.format_secondary_text(str(message)[:600])
        dialog.run()
        dialog.destroy()


def main():
    settings = Gtk.Settings.get_default()
    if settings:
        settings.set_property("gtk-application-prefer-dark-theme", True)
    window = StoreWindow()
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
