import os

import cv2
import numpy as np


BASE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        ".."
    )
)

PUBLIC_DIR = os.path.join(
    BASE_DIR,
    "backend",
    "public"
)

os.makedirs(
    PUBLIC_DIR,
    exist_ok=True
)

WIDTH = 1280
HEIGHT = 720
FPS = 24
FRAMES = 144

ZONES = {
    "Entrance": (0, 0, WIDTH // 2, HEIGHT // 2),
    "Lobby": (WIDTH // 2, 0, WIDTH, HEIGHT // 2),
    "Escalator": (0, HEIGHT // 2, WIDTH // 2, HEIGHT),
    "Exit": (WIDTH // 2, HEIGHT // 2, WIDTH, HEIGHT)
}

TRACKS = [
    ((120, 160), (570, 540), (34, 197, 94), "ID 1"),
    ((160, 270), (980, 560), (113, 50, 245), "ID 2"),
    ((300, 130), (920, 280), (245, 158, 11), "ID 3"),
    ((520, 610), (1090, 380), (239, 68, 68), "ID 4")
]


def draw_base(frame):
    frame[:] = (246, 248, 252)

    for zone_name, (x1, y1, x2, y2) in ZONES.items():
        cv2.rectangle(
            frame,
            (x1 + 8, y1 + 8),
            (x2 - 8, y2 - 8),
            (113, 50, 245),
            3
        )
        cv2.putText(
            frame,
            zone_name,
            (x1 + 30, y1 + 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.2,
            (16, 17, 20),
            3
        )

    cv2.putText(
        frame,
        "FlowAI demo: synthetic pedestrian trajectories",
        (30, HEIGHT - 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (104, 107, 130),
        2
    )


def interpolate(start, end, progress):
    return (
        int(start[0] + (end[0] - start[0]) * progress),
        int(start[1] + (end[1] - start[1]) * progress)
    )


def main():
    video_path = os.path.join(PUBLIC_DIR, "processed.mp4")
    heatmap_path = os.path.join(PUBLIC_DIR, "heatmap.png")
    preview_path = os.path.join(PUBLIC_DIR, "preview.jpg")

    writer = cv2.VideoWriter(
        video_path,
        cv2.VideoWriter_fourcc(*"avc1"),
        FPS,
        (WIDTH, HEIGHT)
    )

    if not writer.isOpened():
        raise RuntimeError("Cannot create demo processed.mp4")

    heat = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    trails = [[] for _ in TRACKS]
    preview_frame = None

    for frame_index in range(FRAMES):
        frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        draw_base(frame)

        progress = frame_index / (FRAMES - 1)

        for track_index, (start, end, color, label) in enumerate(TRACKS):
            delayed_progress = min(1.0, max(0.0, progress * 1.15 - track_index * 0.08))
            point = interpolate(start, end, delayed_progress)
            trails[track_index].append(point)

            for trail_index in range(1, len(trails[track_index])):
                cv2.line(
                    frame,
                    trails[track_index][trail_index - 1],
                    trails[track_index][trail_index],
                    color,
                    4
                )

            cv2.circle(frame, point, 18, color, -1)
            cv2.circle(frame, point, 22, (255, 255, 255), 3)
            cv2.putText(
                frame,
                label,
                (point[0] + 24, point[1] - 12),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                color,
                2
            )

            if 0 <= point[0] < WIDTH and 0 <= point[1] < HEIGHT:
                heat[point[1], point[0]] += 1

        if frame_index == 8:
            preview_frame = frame.copy()

        writer.write(frame)

    writer.release()

    if preview_frame is None:
        preview_frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        draw_base(preview_frame)

    cv2.imwrite(preview_path, preview_frame)

    heat = cv2.GaussianBlur(heat, (151, 151), 0)
    max_value = np.max(heat)

    if max_value > 0:
        heat = np.uint8(255 * heat / max_value)
    else:
        heat = np.uint8(heat)

    heat_color = cv2.applyColorMap(heat, cv2.COLORMAP_JET)
    base = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    draw_base(base)
    overlay = cv2.addWeighted(base, 0.62, heat_color, 0.38, 0)
    cv2.imwrite(heatmap_path, overlay)

    print("Demo media generated")


if __name__ == "__main__":
    main()
