import pandas as pd
import json
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

default_stats_path = os.path.join(
    BASE_DIR,
    "backend",
    "outputs",
    "stats.json"
)

TRAJECTORY_PATH = sys.argv[1] if len(sys.argv) > 1 else default_trajectory_path
STATS_PATH = sys.argv[2] if len(sys.argv) > 2 else default_stats_path

os.makedirs(
    os.path.dirname(STATS_PATH),
    exist_ok=True
)

# =========================
# LOAD CSV
# =========================

df = pd.read_csv(
    TRAJECTORY_PATH
)

known_df = df[
    df["zone"].fillna("Unknown") != "Unknown"
]

if df.empty:
    stats = {
        "total_people": 0,
        "most_crowded_zone": "-",
        "popular_path": "No movement",
        "zone_counts": {},
        "transitions": {},
        "timeline": [],
        "congestion_alert": "Normal"
    }

    with open(STATS_PATH, "w") as f:
        json.dump(stats, f, indent=4)

    print("Analytics completed")
    raise SystemExit

# =========================
# TOTAL PEOPLE
# =========================

total_people = int(

    df["person_id"].nunique()

)

# =========================
# MOST CROWDED ZONE
# =========================

if known_df.empty:
    most_crowded_zone = "-"
else:
    most_crowded_zone = (
        known_df["zone"]
        .value_counts()
        .idxmax()
    )

# =========================
# PERSON PATHS
# =========================

person_paths = {}
transitions = {}

for person_id in df["person_id"].unique():

    person_df = known_df[
        known_df["person_id"] == person_id
    ]

    zone_sequence = (

        person_df["zone"]
        .tolist()

    )

    # REMOVE DUPLICATES
    cleaned = []

    for z in zone_sequence:

        if (
            len(cleaned) == 0
            or
            cleaned[-1] != z
        ):

            cleaned.append(z)

    # SAVE PATH
    if len(cleaned) >= 2:

        path = (
            cleaned[0]
            + " → "
            + cleaned[-1]
        )

        person_paths[path] = (

            person_paths.get(path, 0)
            + 1

        )

        for i in range(1, len(cleaned)):
            transition = cleaned[i - 1] + " → " + cleaned[i]
            transitions[transition] = transitions.get(transition, 0) + 1

# =========================
# POPULAR PATH
# =========================

if len(person_paths) > 0:

    popular_path = max(

        person_paths,

        key=person_paths.get
    )

else:

    popular_path = "No movement"

# =========================
# ZONE COUNTS
# =========================

zone_counts = {}
dwell_times = {}
fps = 30

for zone in known_df["zone"].unique():

    unique_people = (

        known_df[
            known_df["zone"] == zone
        ]["person_id"]

        .nunique()
    )

    zone_counts[zone] = int(
        unique_people
    )

    dwell_times[zone] = round(
        float(
            known_df[
                known_df["zone"] == zone
            ].shape[0]
        ) / fps,
        2
    )

# =========================
# TIMELINE
# =========================

timeline = []
max_frame = int(df["frame"].max())
bucket_count = 8
bucket_size = max(1, max_frame // bucket_count)

for start in range(0, max_frame + 1, bucket_size):
    end = start + bucket_size
    bucket_df = df[
        (df["frame"] >= start)
        &
        (df["frame"] < end)
    ]

    timeline.append({
        "label": f"{start}-{end}",
        "count": int(bucket_df["person_id"].nunique())
    })

# =========================
# CONGESTION ALERT
# =========================

congestion_alert = "Normal"

for zone, count in zone_counts.items():

    if count > 15:

        congestion_alert = (
            f"🔴 High congestion in {zone}"
        )

        break

    elif count > 10:

        congestion_alert = (
            f"🟡 Moderate traffic in {zone}"
        )

# =========================
# STATS JSON
# =========================

stats = {

    "total_people":
        total_people,

    "most_crowded_zone":
        most_crowded_zone,

    "popular_path":
        popular_path,

    "zone_counts":
        zone_counts,

    "transitions":
        transitions,

    "timeline":
        timeline,

    "dwell_times":
        dwell_times,

    "congestion_alert":
        congestion_alert
}

# =========================
# SAVE JSON
# =========================

with open(
    STATS_PATH,

    "w"

) as f:

    json.dump(
        stats,
        f,
        indent=4
    )

print(
    "Analytics completed"
)
