
import pandas as pd
import cv2
import numpy as np

# =========================
# LOAD CSV
# =========================

df = pd.read_csv(
    "backend/outputs/trajectories.csv"
)

# =========================
# LOAD VIDEO FRAME
# =========================

cap = cv2.VideoCapture(
    "backend/public/processed.mp4"
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

heatmap = np.uint8(

    255 *
    heatmap /
    np.max(heatmap)

)

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
    "backend/public/heatmap.png",
    overlay
)

print("Heatmap generated")
