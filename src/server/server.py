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

    Each published message goes to every browser; send_to() answers one browser. A message from a
    browser first goes to on_message(client, message), which returns True when it handled it (the AI
    service does this, on the server thread, without blocking). Every other message is queued as
    parsed JSON for the main loop to collect with poll().
    """

    def __init__(self, host: str, port: int, on_message=None, on_close=None) -> None:
        self._host = host
        self._port = port
        self._incoming: queue.Queue[dict] = queue.Queue()
        self._on_message = on_message
        self._manager = WebSocketManager(self._receive, on_close)
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

    def send_to(self, client, message: dict) -> None:
        """Safe to call from any thread. Sends to one browser only."""
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._manager.send, client, json.dumps(message))

    def poll(self) -> list[dict]:
        """Returns and clears the browser messages received since the last call."""
        messages = []
        while True:
            try:
                messages.append(self._incoming.get_nowait())
            except queue.Empty:
                return messages

    def _receive(self, client, text: str) -> None:
        try:
            message = json.loads(text)
        except ValueError:
            print("Ignoring browser message that is not JSON")
            return
        if not isinstance(message, dict):
            return
        if self._on_message is not None:
            try:
                if self._on_message(client, message):
                    return
            except Exception as error:  # noqa: BLE001 - one bad message must not stop the server
                print(f"Browser message handler failed: {error!r}")
                return
        self._incoming.put(message)
