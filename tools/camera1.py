import cv2

CAMERA_INDEX = 0

camera = cv2.VideoCapture(CAMERA_INDEX)

if not camera.isOpened():
    print(f"ERROR: Could not open camera {CAMERA_INDEX}")
    raise SystemExit(1)

width = int(camera.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(camera.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"Camera {CAMERA_INDEX} opened at {width}x{height}")
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