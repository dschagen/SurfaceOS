import json
import socket
import time
import unittest

from websockets.sync.client import connect

import helpers  # noqa: F401
from server.server import SurfaceServer


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerTransportTests(unittest.TestCase):
    def test_replies_reach_one_browser_and_broadcasts_reach_all(self):
        received, closed = [], []
        port = free_port()
        server = SurfaceServer("localhost", port,
                               on_message=lambda client, message: (received.append(message), server.send_to(client, {"echo": message["n"]})),
                               on_close=closed.append)
        server.start()
        for _ in range(50):
            try:
                a = connect(f"ws://localhost:{port}")
                break
            except OSError:
                time.sleep(0.05)
        b = connect(f"ws://localhost:{port}")
        a.send(json.dumps({"n": 1}))
        self.assertEqual(json.loads(a.recv(timeout=2)), {"echo": 1})
        a.send("not json")
        server.publish({"type": "pointer_move"})
        self.assertEqual(json.loads(a.recv(timeout=2)), {"type": "pointer_move"}, "bad JSON did not drop the connection")
        self.assertEqual(json.loads(b.recv(timeout=2)), {"type": "pointer_move"}, "b never saw a's reply")
        self.assertEqual(received, [{"n": 1}])
        a.close()
        b.close()
        for _ in range(40):
            if len(closed) == 2:
                break
            time.sleep(0.05)
        self.assertEqual(len(closed), 2)


if __name__ == "__main__":
    unittest.main()
