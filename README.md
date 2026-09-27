# SurfaceOS
Turn any table into a touchscreen. Webcam hand tracking + projector = gesture-controlled surface computing. Built at ShellHacks 2026.

## Setup (once per computer)

From the repository root, with Python 3.11:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The hand tracker needs MediaPipe's gesture recognizer model, which is not stored in Git. Download it into `models/`:

```powershell
New-Item -ItemType Directory -Force models | Out-Null
Invoke-WebRequest https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task -OutFile models\gesture_recognizer.task
```

Node.js is only needed to run the shell unit tests.

## Run

1. Hand tracker: `.\.venv\Scripts\python.exe src\main.py` (camera index and 1080p/30 fps mode are in `config/settings.json`).
2. Web page: `.\.venv\Scripts\python.exe tools\dev_server.py`, then open `http://localhost:8000/surfaceos-shell/frontend/`. Add `?hand=off` for mouse only.
3. Move the browser to the projector, press **F** for fullscreen, and follow the setup panel: corners, markers, then hold on C and OK.

Gestures, calibration and the event contract are described in `surfaceos-shell/README.md`, `surfaceos-shell/UX_FLOW.md` and `docs/input.md`.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
npm test --prefix surfaceos-shell
.\.venv\Scripts\python.exe tools\integration_smoke.py
```
