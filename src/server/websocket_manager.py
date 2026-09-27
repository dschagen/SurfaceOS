import json

from websockets.asyncio.server import ServerConnection, broadcast


class WebSocketManager:
    """Tracks connected browsers, sends messages to all of them, and passes their messages on.

    on_message(client, message) receives each JSON object a browser sends; on_close(client) runs when
    it disconnects. Both run on the server's event loop thread and must not block.
    """

    def __init__(self, on_message=None, on_close=None) -> None:
        self._clients: set[ServerConnection] = set()
        self._on_message = on_message
        self._on_close = on_close

    async def handle_client(self, websocket: ServerConnection) -> None:
        self._clients.add(websocket)
        print(f"Browser connected ({len(self._clients)} total)")
        try:
            async for raw in websocket:
                if self._on_message is None:
                    continue
                try:
                    message = json.loads(raw)
                except (TypeError, ValueError):
                    print("Ignoring a browser message that is not JSON")
                    continue
                try:
                    self._on_message(websocket, message)
                except Exception as error:  # noqa: BLE001 - one bad message must not drop the connection
                    print(f"Browser message handler failed: {error!r}")
        except Exception:  # noqa: BLE001 - a dropped connection ends like a normal close
            pass
        finally:
            self._clients.discard(websocket)
            if self._on_close is not None:
                self._on_close(websocket)
            print(f"Browser disconnected ({len(self._clients)} total)")

    def broadcast(self, message: str) -> None:
        # Must run on the server's event loop thread. Slow clients are skipped, not awaited.
        broadcast(self._clients, message)

    def send(self, client: ServerConnection, message: str) -> None:
        # Must run on the server's event loop thread; the message is dropped if the client has left.
        if client in self._clients:
            broadcast({client}, message)
