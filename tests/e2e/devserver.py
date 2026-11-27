import http.server, os, sys, functools
REPO, FIX, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/__fixtures__/"):
            from urllib.parse import unquote
            return os.path.join(FIX, unquote(clean[len("/__fixtures__/"):]))
        return super().translate_path(path)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass
class S(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True
S(("127.0.0.1", PORT), functools.partial(H, directory=REPO)).serve_forever()
