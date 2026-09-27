import asyncio
import json
import queue
import threading

from websockets.asyncio.server import serve

from server.websocket_manager import WebSocketManager

# Browser messages are small requests; anything larger is refused by the WebSocket layer.
MAX_INCOMING_BYTES = 256_000


class SurfaceServer:
    """Runs the WebSocket server on a background thread.

    Each published message goes to every browser. Messages from browsers are queued as parsed
    JSON objects for the main loop to collect with poll().
    """

    def __init__(self, host: str, port: int) -> None:
        self._host = host
        self._port = port
        self._incoming: queue.Queue[dict] = queue.Queue()
        self._manager = WebSocketManager(self._receive)
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        # Daemon thread exits automatically when the main loop ends.
        threading.Thread(target=lambda: asyncio.run(self._run()), daemon=True).start()

    async def _run(self) -> None:
        async with serve(self._manager.handle_client, self._host, self._port,
                         max_size=MAX_INCOMING_BYTES) as server:
            self._loop = asyncio.get_running_loop()
            print(f"WebSocket server listening on ws://{self._host}:{self._port}")
            await server.serve_forever()

    def publish(self, message: dict) -> None:
        """Safe to call from any thread. Messages before the server is ready are dropped."""
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._manager.broadcast, json.dumps(message))

    def poll(self) -> list[dict]:
        """Returns and clears the browser messages received since the last call."""
        messages = []
        while True:
            try:
                messages.append(self._incoming.get_nowait())
            except queue.Empty:
                return messages

    def _receive(self, text: str) -> None:
        try:
            message = json.loads(text)
        except ValueError:
            print("Ignoring browser message that is not JSON")
            return
        if isinstance(message, dict):
            self._incoming.put(message)
