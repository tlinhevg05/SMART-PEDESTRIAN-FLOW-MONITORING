
from collections import defaultdict
from ultralytics import YOLO
import zones
import cv2
import csv
import sys
import os

# =========================
# INPUT VIDEO
# =========================

BASE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        ".."
    )
)

video_path = sys.argv[1]

# =========================
# LOAD MODEL
# =========================

model = YOLO("yolov8n.pt")

# =========================
# VIDEO INFO
# =========================

cap = cv2.VideoCapture(video_path)

width = int(
    cap.get(cv2.CAP_PROP_FRAME_WIDTH)
)

height = int(
    cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
)

zones.load_zones(
    width,
    height
)
print("LOADED ZONES:")
print(zones.ZONES)

fps = cap.get(
    cv2.CAP_PROP_FPS
)

if fps == 0:
    fps = 30

# =========================
# OUTPUT PATHS
# =========================

default_output_video = os.path.join(
    BASE_DIR,
    "backend",
    "public",
    "processed.mp4"
)

default_output_csv = os.path.join(
    BASE_DIR,
    "backend",
    "outputs",
    "trajectories.csv"
)

output_video = sys.argv[2] if len(sys.argv) > 2 else default_output_video
output_csv = sys.argv[3] if len(sys.argv) > 3 else default_output_csv

os.makedirs(
    os.path.dirname(output_video),
    exist_ok=True
)

os.makedirs(
    os.path.dirname(output_csv),
    exist_ok=True
)

# =========================
# VIDEO WRITER
# =========================

fourcc = cv2.VideoWriter_fourcc(
    *"avc1"
)

out = cv2.VideoWriter(
    output_video,
    fourcc,
    fps,
    (width, height)
)

if not out.isOpened():

    print(
        "ERROR: VideoWriter failed"
    )

    sys.exit()

# =========================
# YOLO TRACKING
# =========================

results = model.track(
    source=video_path,
    tracker="bytetrack.yaml",
    stream=True,
    persist=True
)

# =========================
# CSV FILE
# =========================

csv_file = open(
    output_csv,
    mode="w",
    newline=""
)

writer = csv.writer(csv_file)

writer.writerow([
    "frame",
    "person_id",
    "x",
    "y",
    "zone"
])

# =========================
# TRAJECTORY HISTORY
# =========================

track_history = defaultdict(list)

frame_id = 0

# =========================
# MAIN LOOP
# =========================

for result in results:

    frame = result.orig_img

    boxes = result.boxes

    if (
        boxes.id is not None
        and boxes.cls is not None
    ):

        ids = boxes.id.cpu().numpy()

        coords = (
            boxes.xyxy.cpu().numpy()
        )

        classes = (
            boxes.cls.cpu().numpy()
        )

        for i in range(len(ids)):

            # PERSON ONLY
            if int(classes[i]) != 0:
                continue

            person_id = int(ids[i])

            x1, y1, x2, y2 = coords[i]

            center_x = int(
                (x1 + x2) / 2
            )

            center_y = int(
                (y1 + y2) / 2
            )

            # =========================
            # SAVE CSV
            # =========================
            zone = zones.get_zone(
                center_x,
                center_y
            )
            writer.writerow([
                frame_id,
                person_id,
                center_x,
                center_y, 
                zone
            ])

            # =========================
            # DRAW BOUNDING BOX
            # =========================

            cv2.rectangle(
                frame,
                (int(x1), int(y1)),
                (int(x2), int(y2)),
                (0, 255, 0),
                2
            )

            # =========================
            # DRAW ID
            # =========================

            cv2.putText(
                frame,
                f"ID {person_id}",
                (
                    int(x1),
                    int(y1) - 10
                ),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0),
                2
            )

            # =========================
            # TRACK HISTORY
            # =========================

            track = track_history[
                person_id
            ]

            track.append(
                (center_x, center_y)
            )

            # LIMIT TRAIL LENGTH
            if len(track) > 30:
                track.pop(0)

            # =========================
            # DRAW TRAJECTORY
            # =========================

            for j in range(
                1,
                len(track)
            ):

                cv2.line(
                    frame,
                    track[j - 1],
                    track[j],
                    (0, 0, 255),
                    2
                )

    # =========================
    # DRAW ZONES
    # =========================

    for zone_name, (

        zx1,
        zy1,
        zx2,
        zy2

    ) in zones.ZONES.items():

        cv2.rectangle(

            frame,

            (zx1, zy1),
            (zx2, zy2),

            (255, 0, 0),

            2
        )

        cv2.putText(

            frame,

            zone_name,

            (
                zx1 + 10,
                zy1 + 30
            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            1,

            (255, 0, 0),

            2
        )
        
    # =========================
    
    # WRITE FRAME
    
    # =========================
    
    out.write(frame)

    frame_id += 1

# =========================
# CLEANUP
# =========================

csv_file.close()

out.release()

cap.release()

cv2.destroyAllWindows()

print("Tracking completed")

print("Processed video saved")
