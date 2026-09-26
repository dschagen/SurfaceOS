from websockets.asyncio.server import ServerConnection, broadcast


class WebSocketManager:
    """Tracks connected browsers and sends messages to all of them."""

    def __init__(self) -> None:
        self._clients: set[ServerConnection] = set()

    async def handle_client(self, websocket: ServerConnection) -> None:
        self._clients.add(websocket)
        print(f"Browser connected ({len(self._clients)} total)")
        try:
            await websocket.wait_closed()
        finally:
            self._clients.discard(websocket)
            print(f"Browser disconnected ({len(self._clients)} total)")

    def broadcast(self, message: str) -> None:
        # Must run on the server's event loop thread. Slow clients are skipped, not awaited.
        broadcast(self._clients, message)