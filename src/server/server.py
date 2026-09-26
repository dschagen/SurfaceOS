import asyncio
import json
import threading

from websockets.asyncio.server import serve

from server.websocket_manager import WebSocketManager


class SurfaceServer:
    """Runs the WebSocket server on a background thread and sends each message to every browser."""

    def __init__(self, host: str, port: int) -> None:
        self._host = host
        self._port = port
        self._manager = WebSocketManager()
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        # Daemon thread exits automatically when the main loop ends.
        threading.Thread(target=lambda: asyncio.run(self._run()), daemon=True).start()

    async def _run(self) -> None:
        async with serve(self._manager.handle_client, self._host, self._port) as server:
            self._loop = asyncio.get_running_loop()
            print(f"WebSocket server listening on ws://{self._host}:{self._port}")
            await server.serve_forever()

    def publish(self, message: dict) -> None:
        """Safe to call from any thread. Messages before the server is ready are dropped."""
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._manager.broadcast, json.dumps(message))