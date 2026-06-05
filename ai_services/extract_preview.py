import cv2
import sys
import os

BASE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        ".."
    )
)

video_path = sys.argv[1]

preview_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    BASE_DIR,
    "backend",
    "public",
    "preview.jpg"
)

os.makedirs(
    os.path.dirname(preview_path),
    exist_ok=True
)

cap = cv2.VideoCapture(video_path)

success, frame = cap.read()

if success:

    cv2.imwrite(preview_path, frame)

cap.release()

print("Preview generated")
