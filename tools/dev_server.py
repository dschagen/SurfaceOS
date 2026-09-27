"""Serves the repository for local testing with browser caching turned off.

Browsers may keep reusing an old copy of a script that python -m http.server served, so a page
can mix new and old files after an edit. This server marks every response as not cacheable.

Run from anywhere:  python tools/dev_server.py [port]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("", port), partial(NoCacheHandler, directory=str(ROOT)))
    print(f"Serving {ROOT} at http://localhost:{port}/surfaceos-shell/frontend/ (caching off)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
