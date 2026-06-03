import json
import os

ZONES = {}


def load_zones(video_width, video_height):

    global ZONES

    zones_file = (
        r"D:\SE\backend\outputs\zones.json"
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

    grid_size = data["grid_size"]

    saved_zones = data["zones"]

    cell_width = (
        video_width // grid_size
    )

    cell_height = (
        video_height // grid_size
    )

    zones = {}

    for zone in saved_zones:

        index = zone["grid_position"]

        row = index // grid_size

        col = index % grid_size

        x1 = col * cell_width
        y1 = row * cell_height

        x2 = x1 + cell_width
        y2 = y1 + cell_height

        zones[
            zone["name"]
        ] = (
            x1,
            y1,
            x2,
            y2
        )

    ZONES = zones

    print(
        "Loaded",
        len(ZONES),
        "zones"
    )

    return zones


def get_zone(x, y):

    for zone_name, (

        x1,
        y1,
        x2,
        y2

    ) in ZONES.items():

        if (

            x1 <= x <= x2
            and
            y1 <= y <= y2

        ):

            return zone_name

    return "Unknown"