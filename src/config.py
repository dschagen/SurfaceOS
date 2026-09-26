from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = PROJECT_ROOT / "models" / "gesture_recognizer.task"
SNIP_DIR = PROJECT_ROOT / "snips"

# Camera
CAMERA_INDEX = 0
MAX_HANDS = 2

# A laptop webcam faces you, so the image is mirrored for natural cursor movement.
# Set to False once the camera looks down at the projected table.
MIRROR_X = True

# 0 = raw and jittery, closer to 1 = smoother but laggier.
SMOOTHING = 0.5

# Pinch ratio = thumb-to-index distance divided by hand size.
# Two thresholds keep the pinch from flickering at the boundary.
PINCH_START_RATIO = 0.25
PINCH_END_RATIO = 0.35

# Snip tool
# "screen" saves that region of the monitor; "camera" saves that region of the webcam image.
SNIP_SOURCE = "screen"
# 1 = primary monitor. Set to 2 when the projector is the second display.
SNIP_MONITOR = 1
# Snips smaller than this fraction of the screen are treated as accidental.
MIN_SNIP_SIZE = 0.03
# Gives the browser time to hide its overlay before the screenshot.
CAPTURE_DELAY_S = 0.15

# Server
SERVER_HOST = "localhost"
SERVER_PORT = 8765
SEND_RATE_HZ = 60

# Set to False if the preview window gets in the way of screen snips.
# Without the preview window, quit with Ctrl + C in the terminal.
SHOW_PREVIEW = True
