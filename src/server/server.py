import asyncio
import json
import threading

from websockets.asyncio.server import serve

from server.websocket_manager import WebSocketManager

# Browser messages can carry an image for the AI service (limit 4 MB before base64).
MAX_MESSAGE_BYTES = 8 * 1024 * 1024


class SurfaceServer:
    """Runs the WebSocket server on a background thread.

    publish() sends a message to every browser. send_to() answers one browser. Messages from
    browsers go to on_message(client, message), which must return quickly.
    """

    def __init__(self, host: str, port: int, on_message=None, on_close=None) -> None:
        self._host = host
        self._port = port
        self._manager = WebSocketManager(on_message, on_close)
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        # Daemon thread exits automatically when the main loop ends.
        threading.Thread(target=lambda: asyncio.run(self._run()), daemon=True).start()

    async def _run(self) -> None:
        async with serve(self._manager.handle_client, self._host, self._port, max_size=MAX_MESSAGE_BYTES) as server:
            self._loop = asyncio.get_running_loop()
            print(f"WebSocket server listening on ws://{self._host}:{self._port}")
            await server.serve_forever()

    def publish(self, message: dict) -> None:
        """Safe to call from any thread. Messages before the server is ready are dropped."""
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._manager.broadcast, json.dumps(message))

    def send_to(self, client, message: dict) -> None:
        """Safe to call from any thread. Sends to one browser only."""
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._manager.send, client, json.dumps(message))
