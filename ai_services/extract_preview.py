import cv2
import sys

video_path = sys.argv[1]

cap = cv2.VideoCapture(video_path)

success, frame = cap.read()

if success:

    cv2.imwrite(
        r"D:\SE\backend\public\preview.jpg",
        frame
    )

cap.release()

print("Preview generated")