import json
import os
import cv2
import numpy as np

ZONES = {}

BASE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        ".."
    )
)


def load_zones(video_width, video_height):

    global ZONES

    zones_file = os.path.join(
        BASE_DIR,
        "backend",
        "outputs",
        "zones.json"
    )

    if not os.path.exists(zones_file):

        print("zones.json not found")

        return {}

    with open(
        zones_file,
        "r",
        encoding="utf-8"
    ) as f:

        data = json.load(f)

    zones = {}

    for zone in data.get("zones", []):

        geometry = normalize_geometry(
            zone,
            data.get("grid_size", 2),
            video_width,
            video_height
        )

        if geometry:
            zones[zone["name"]] = geometry

    ZONES = zones

    print(
        "Loaded",
        len(ZONES),
        "zones"
    )

    return zones


def get_zone(x, y):

    for zone_name, geometry in ZONES.items():

        if geometry["shape"] == "line":
            continue

        polygon = np.array(
            geometry["points"],
            dtype=np.int32
        )

        if cv2.pointPolygonTest(polygon, (x, y), False) >= 0:

            return zone_name

    return "Unknown"


def normalize_geometry(zone, grid_size, video_width, video_height):

    raw_coordinates = zone.get("coordinates")
    points = []
    shape = "polygon"

    if isinstance(raw_coordinates, dict):
        shape = raw_coordinates.get("shape", "polygon")
        points = raw_coordinates.get("points", [])
    elif isinstance(raw_coordinates, list):
        shape = "line" if len(raw_coordinates) == 2 else "polygon"
        points = raw_coordinates

    if not points:
        points = grid_cell_points(
            zone.get("grid_position", 0),
            grid_size
        )
        shape = "polygon"

    pixel_points = [
        (
            int(point["x"] * video_width),
            int(point["y"] * video_height)
        )
        for point in points
        if "x" in point and "y" in point
    ]

    if shape == "line" and len(pixel_points) >= 2:
        return {
            "shape": "line",
            "points": pixel_points[:2]
        }

    if len(pixel_points) >= 3:
        return {
            "shape": "polygon",
            "points": pixel_points
        }

    return None


def grid_cell_points(index, grid_size):

    row = index // grid_size
    col = index % grid_size
    x1 = col / grid_size
    y1 = row / grid_size
    x2 = (col + 1) / grid_size
    y2 = (row + 1) / grid_size

    return [
        {"x": x1, "y": y1},
        {"x": x2, "y": y1},
        {"x": x2, "y": y2},
        {"x": x1, "y": y2}
    ]
