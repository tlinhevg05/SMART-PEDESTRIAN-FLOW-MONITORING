
import pandas as pd
import cv2
import numpy as np
import os
import sys

BASE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        ".."
    )
)

default_trajectory_path = os.path.join(
    BASE_DIR,
    "backend",
    "outputs",
    "trajectories.csv"
)

default_processed_video_path = os.path.join(
    BASE_DIR,
    "backend",
    "public",
    "processed.mp4"
)

default_heatmap_path = os.path.join(
    BASE_DIR,
    "backend",
    "public",
    "heatmap.png"
)

TRAJECTORY_PATH = sys.argv[1] if len(sys.argv) > 1 else default_trajectory_path
PROCESSED_VIDEO_PATH = sys.argv[2] if len(sys.argv) > 2 else default_processed_video_path
HEATMAP_PATH = sys.argv[3] if len(sys.argv) > 3 else default_heatmap_path

os.makedirs(
    os.path.dirname(HEATMAP_PATH),
    exist_ok=True
)

# =========================
# LOAD CSV
# =========================

df = pd.read_csv(
    TRAJECTORY_PATH
)

# =========================
# LOAD VIDEO FRAME
# =========================

cap = cv2.VideoCapture(
    PROCESSED_VIDEO_PATH
)

ret, frame = cap.read()

cap.release()

if not ret:

    print("Cannot read video")

    exit()

height, width = frame.shape[:2]

# =========================
# CREATE HEATMAP
# =========================

heatmap = np.zeros(
    (height, width),
    dtype=np.float32
)

for _, row in df.iterrows():

    x = int(row["x"])
    y = int(row["y"])

    if (
        0 <= x < width
        and 0 <= y < height
    ):

        heatmap[y, x] += 1

# =========================
# SMOOTH
# =========================

heatmap = cv2.GaussianBlur(
    heatmap,
    (101, 101),
    0
)

# =========================
# NORMALIZE
# =========================

max_value = np.max(heatmap)

if max_value > 0:
    heatmap = np.uint8(
        255 *
        heatmap /
        max_value
    )
else:
    heatmap = np.uint8(heatmap)

# =========================
# APPLY COLOR
# =========================

heatmap_color = cv2.applyColorMap(
    heatmap,
    cv2.COLORMAP_JET
)

# =========================
# OVERLAY
# =========================

overlay = cv2.addWeighted(
    frame,
    0.6,
    heatmap_color,
    0.4,
    0
)

# =========================
# SAVE
# =========================

cv2.imwrite(
    HEATMAP_PATH,
    overlay
)

print("Heatmap generated")
