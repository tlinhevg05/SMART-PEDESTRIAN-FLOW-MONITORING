import pandas as pd
import json

# =========================
# LOAD CSV
# =========================

df = pd.read_csv(
    "backend/outputs/trajectories.csv"
)

# =========================
# TOTAL PEOPLE
# =========================

total_people = int(

    df["person_id"].nunique()

)

# =========================
# MOST CROWDED ZONE
# =========================

most_crowded_zone = (

    df["zone"]
    .value_counts()
    .idxmax()

)

# =========================
# PERSON PATHS
# =========================

person_paths = {}

for person_id in df["person_id"].unique():

    person_df = df[
        df["person_id"] == person_id
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

for zone in df["zone"].unique():

    unique_people = (

        df[
            df["zone"] == zone
        ]["person_id"]

        .nunique()
    )

    zone_counts[zone] = int(
        unique_people
    )

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

    "congestion_alert":
        congestion_alert
}

# =========================
# SAVE JSON
# =========================

with open(

    "backend/outputs/stats.json",

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

