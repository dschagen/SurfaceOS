import asyncio
import json
import threading

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

import config


class StateServer:
    """Streams the latest SurfaceOS state to every connected browser over WebSocket."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: dict = {}

    def update(self, state: dict) -> None:
        with self._lock:
            self._state = state

    def start(self) -> None:
        # Daemon thread exits automatically when the main loop ends.
        thread = threading.Thread(target=lambda: asyncio.run(self._run()), daemon=True)
        thread.start()

    async def _run(self) -> None:
        async with serve(self._handle_browser, config.SERVER_HOST, config.SERVER_PORT) as server:
            print(f"WebSocket server listening on ws://{config.SERVER_HOST}:{config.SERVER_PORT}")
            await server.serve_forever()

    async def _handle_browser(self, websocket) -> None:
        print("Browser connected")
        try:
            while True:
                with self._lock:
                    message = json.dumps(self._state)
                await websocket.send(message)
                await asyncio.sleep(1 / config.SEND_RATE_HZ)
        except ConnectionClosed:
            print("Browser disconnected")
