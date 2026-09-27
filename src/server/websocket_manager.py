from collections.abc import Callable

from websockets.asyncio.server import ServerConnection, broadcast
from websockets.exceptions import ConnectionClosed


class WebSocketManager:
    """Tracks connected browsers, sends messages to all of them, and passes on what they send."""

    def __init__(self, on_message: Callable[[str], None] | None = None) -> None:
        self._clients: set[ServerConnection] = set()
        self._on_message = on_message

    async def handle_client(self, websocket: ServerConnection) -> None:
        self._clients.add(websocket)
        print(f"Browser connected ({len(self._clients)} total)")
        try:
            async for message in websocket:
                if self._on_message is not None and isinstance(message, str):
                    self._on_message(message)
        except ConnectionClosed:
            pass  # a closed tab or dropped connection ends this client normally
        except Exception as error:  # anything else must not stop the server
            print(f"Browser connection error: {error}")
        finally:
            self._clients.discard(websocket)
            print(f"Browser disconnected ({len(self._clients)} total)")

    def broadcast(self, message: str) -> None:
        # Must run on the server's event loop thread. Slow clients are skipped, not awaited.
        broadcast(self._clients, message)
