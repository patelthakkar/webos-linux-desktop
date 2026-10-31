#!/usr/bin/env python3
"""Small root helper for the on-desktop App Store.

Only catalog package IDs can be installed or removed. It never runs a shell,
accepts no arbitrary arguments, and removes the APK index after every job.
"""
import grp
import json
import os
import re
import shutil
import signal
import socketserver
import subprocess
import sys
import threading
import time

SOCKET_PATH = "/run/appstore.sock"
CATALOG_PATH = os.environ.get(
    "APPSTORE_CATALOG", "/usr/local/share/linux-desktop-appstore/catalog.json"
)
LOG_PATH = "/tmp/appstore.log"
MIN_FREE = 64 * 1024 * 1024
APK_TIMEOUT = 300
PROTECTED = {
    "alpine-base",
    "apk-tools",
    "busybox",
    "desktop-session",
    "gtk+3.0",
    "netsurf",
    "novnc",
    "py3-gobject3",
    "python3",
    "tigervnc",
    "websockify",
    "xfce4",
    "xfce4-panel",
    "xfce4-session",
    "xfdesktop",
    "xfwm4",
    "xorg-server",
}
JOB_LOCK = threading.Lock()
JOB = {"state": "idle"}


def read_catalog():
    with open(CATALOG_PATH, encoding="utf-8") as handle:
        apps = json.load(handle)
    allowed = set()
    for app in apps:
        if set(app) != {"id", "name", "summary", "size_mb", "category"}:
            raise ValueError("Invalid catalog entry")
        if not re.fullmatch(r"[a-z0-9][a-z0-9+._-]*", app["id"]):
            raise ValueError("Invalid package id")
        if app["id"] in PROTECTED or app["id"] in allowed:
            raise ValueError("Duplicate or protected package")
        allowed.add(app["id"])
    return apps, allowed


CATALOG, ALLOWED = read_catalog()


def log_line(message):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n"
    with open(LOG_PATH, "a", encoding="utf-8") as handle:
        handle.write(line)


def setup_log():
    with open(LOG_PATH, "w", encoding="utf-8") as handle:
        handle.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} app store helper started\n")


def free_bytes():
    stats = os.statvfs("/")
    return stats.f_bavail * stats.f_frsize


def installed_packages():
    try:
        result = subprocess.run(
            ["/sbin/apk", "info"],
            capture_output=True,
            text=True,
            timeout=15,
            env={"PATH": "/sbin:/usr/sbin:/bin:/usr/bin", "LANG": "C"},
        )
    except (OSError, subprocess.SubprocessError):
        return set()
    if result.returncode != 0:
        return set()
    return set(result.stdout.split())


def catalog_payload():
    if not os.path.isdir("/sbin") or not os.path.exists("/sbin/apk"):
        return {"ok": False, "error": "The Alpine package manager is unavailable."}
    installed = installed_packages()
    apps = []
    for app in CATALOG:
        apps.append({
            **app,
            "installed": app["id"] in installed,
            "protected": app["id"] in PROTECTED,
        })
    return {"ok": True, "apps": apps, "free_mb": round(free_bytes() / 1048576, 1)}


def parse_progress(line):
    match = re.search(r"\((\d+)/(\d+)\)\s+(?:Installing|Purging)", line)
    if match:
        total = int(match.group(2))
        return int(match.group(1)) / total if total else None
    return None


def set_job(**values):
    with JOB_LOCK:
        JOB.update(values)


def job_payload():
    with JOB_LOCK:
        return dict(JOB)


def run_job(action, package):
    args = ["/sbin/apk", "del", package]
    if action == "install":
        args = ["/sbin/apk", "add", "--no-cache", "--update-cache", package]
    set_job(state="running", action=action, id=package, message="Starting…", progress=0)
    log_line(f"{action} {package}")
    process = None
    killed = False
    try:
        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env={"PATH": "/sbin:/usr/sbin:/bin:/usr/bin", "HOME": "/root", "LANG": "C"},
            cwd="/",
        )

        def stop_process():
            nonlocal killed
            killed = True
            try:
                process.kill()
            except OSError:
                pass

        timer = threading.Timer(APK_TIMEOUT, stop_process)
        timer.start()
        lines = []
        try:
            for line in process.stdout:
                line = line.strip()
                if not line:
                    continue
                lines.append(line)
                lines = lines[-6:]
                progress = parse_progress(line)
                values = {"message": line}
                if progress is not None:
                    values["progress"] = round(progress, 3)
                set_job(**values)
                log_line(line)
            code = process.wait()
        finally:
            timer.cancel()
        if killed:
            raise RuntimeError("The package operation timed out. Check the network and try again.")
        if code != 0:
            raise RuntimeError(lines[-1] if lines else "The package manager returned an error.")
    except Exception as error:  # The daemon reports a short, actionable message to the GUI.
        log_line(f"error: {error}")
        set_job(state="error", message=str(error)[:400], progress=0)
    else:
        verb = "Installed" if action == "install" else "Removed"
        set_job(state="done", message=f"{verb} {package}.", progress=1)
    finally:
        shutil.rmtree("/var/cache/apk", ignore_errors=True)
        try:
            os.makedirs("/var/cache/apk", exist_ok=True)
        except OSError:
            pass


def start_job(action, package):
    if package in PROTECTED:
        return {"ok": False, "error": "This package is part of the base system and cannot be changed."}
    if package not in ALLOWED:
        return {"ok": False, "error": "This package is not in the App Store catalog."}
    with JOB_LOCK:
        if JOB.get("state") == "running":
            return {"ok": False, "error": "Another package operation is still running."}
    installed = package in installed_packages()
    if action == "install" and installed:
        return {"ok": False, "error": "This package is already installed."}
    if action == "remove" and not installed:
        return {"ok": False, "error": "This package is not installed."}
    if action == "install" and free_bytes() < MIN_FREE:
        return {"ok": False, "error": "Not enough free space. Keep at least 64 MB free on the TV."}
    threading.Thread(target=run_job, args=(action, package), daemon=True).start()
    return {"ok": True}


def handle_request(request):
    if not isinstance(request, dict):
        return {"ok": False, "error": "Invalid request."}
    command = request.get("cmd")
    if command == "ping":
        return {"ok": True}
    if command == "catalog":
        return catalog_payload()
    if command == "status":
        return {"ok": True, "job": job_payload()}
    if command in ("install", "remove"):
        package = request.get("id")
        if not isinstance(package, str):
            return {"ok": False, "error": "Invalid package."}
        return start_job(command, package)
    return {"ok": False, "error": "Unknown command."}


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            raw = self.rfile.readline(65536)
            request = json.loads(raw.decode("utf-8"))
            response = handle_request(request)
        except (OSError, ValueError, UnicodeDecodeError):
            response = {"ok": False, "error": "Invalid request."}
        try:
            self.wfile.write((json.dumps(response) + "\n").encode("utf-8"))
        except OSError:
            pass


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    setup_log()
    try:
        os.unlink(SOCKET_PATH)
    except FileNotFoundError:
        pass
    try:
        gid = grp.getgrnam("desk").gr_gid
    except KeyError:
        gid = 1000
    os.umask(0o007)
    server = Server(SOCKET_PATH, Handler)
    os.chown(SOCKET_PATH, 0, gid)
    os.chmod(SOCKET_PATH, 0o660)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            os.unlink(SOCKET_PATH)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    main()
