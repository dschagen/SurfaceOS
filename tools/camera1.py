import cv2

CAMERA_INDEX = 0
CAMERA_WIDTH = 1920
CAMERA_HEIGHT = 1080
CAMERA_FPS = 30

camera = cv2.VideoCapture(CAMERA_INDEX)

if not camera.isOpened():
    print(f"ERROR: Could not open camera {CAMERA_INDEX}")
    raise SystemExit(1)

camera.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
camera.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
camera.set(cv2.CAP_PROP_FPS, CAMERA_FPS)

width = int(camera.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(camera.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"Camera {CAMERA_INDEX} opened at {width}x{height}, {camera.get(cv2.CAP_PROP_FPS):.0f} fps")
print("Press Q in the video window to quit")

while True:
    success, frame = camera.read()
    if not success:
        print("ERROR: Could not read frame")
        break

    cv2.imshow("SurfaceOS Camera Test", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

camera.release()
cv2.destroyAllWindows()