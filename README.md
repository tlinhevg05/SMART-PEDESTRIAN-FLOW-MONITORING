# Pedestrian Flow Monitoring

Smart Pedestrian Flow Monitoring and Analytics System for the IT3180E capstone project.

## Implemented Scope

- Role-based login for `admin`, `operator`, and `analyst`.
- Administrator user management with role/status updates.
- Camera source registration and video upload.
- Camera metadata/status management.
- Zone grid configuration with per-zone type, normalized coordinates, and density threshold.
- YOLOv8 + ByteTrack pedestrian detection/tracking scripts.
- Trajectory CSV output persisted into PostgreSQL track/point tables.
- Dashboard KPI cards, video-time realtime stats, zone chart, timeline chart, transition flow, heatmap, alerts, job history/detail, alert acknowledgement, and CSV report export.
- Historical job selection for loading an older job's dashboard media and analytics.
- Multi-camera overview for comparing camera sources and opening a camera's latest job.
- Polygon zone editing with normalized coordinate storage.
- Printable HTML report and backend-generated PDF report.
- API smoke test script covering login, zones, stats, job detail, multicamera, and reports.
- Dwell-time and density-score analytics per zone.

## PostgreSQL Setup

Default connection used by the app:

```text
host=localhost
port=5432
user=postgres
password=postgres
database=flowai
```

Create the database once:

```bash
createdb -U postgres flowai
```

You can override the defaults with environment variables:

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=flowai npm start
```

The server automatically creates the required tables on startup from:

```text
backend/config/schema.sql
```

## Demo Accounts

```text
admin@flowai.local / admin123
operator@flowai.local / operator123
analyst@flowai.local / analyst123
```

Admin/operator can upload videos, configure zones, and create camera sources. Analyst can view dashboards, alerts, jobs, and export reports.

## Run

If your terminal cannot find `node`, `npm`, or `psql`, add Homebrew tools to the current terminal session:

```bash
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
```

```bash
npm install
python3 -m pip install -r requirements.txt
npm start
```

Open:

```text
http://localhost:3000
```

Python processing uses `python3` by default. Override it if needed:

```bash
PYTHON_BIN=/path/to/python npm start
```

Required Python packages include `ultralytics`, `opencv-python`, `pandas`, and `numpy`.

For the local workspace used during development, the app is often started with `PORT=3001`:

```bash
PORT=3001 PYTHON_BIN=/usr/local/bin/python3 npm start
```

Then open:

```text
http://localhost:3001
```

## Dataset Suggestions

Use short pedestrian/crowd videos that clearly show people moving through zones. For the capstone demo, free stock footage is usually easier than academic benchmarks because it downloads directly in MP4:

- Pixabay crowd walking videos.
- Pexels pedestrian/crosswalk/crowd videos.
- Kaggle pedestrian datasets if you can log in to Kaggle.
- Self-recorded indoor corridor/mall footage, provided privacy rules are respected.

Academic benchmark options can still be mentioned in the report as references, but they are sometimes blocked, moved, or require account access.

Accessible starting points:

- https://pixabay.com/videos/search/crowd%20of%20people%20walking/
- https://www.pexels.com/search/videos/crowd%20of%20feet%20walking/
- https://www.pexels.com/video/people-on-the-street-855329/
- https://www.kaggle.com/datasets/smeschke/pedestrian-dataset

This repository keeps one small demo input video at:

```text
sample_data/mall.mp4
```

Runtime uploads and generated outputs are intentionally ignored by Git:

```text
backend/uploads/
backend/outputs/
backend/public/media/
backend/public/processed.mp4
backend/public/preview.jpg
backend/public/heatmap.png
```

After cloning, upload `sample_data/mall.mp4` from the UI to recreate the demo analysis jobs locally.

## Confirmed Demo Dataset Plan

For the class demo, use one short indoor mall/crowd video per logical camera. A practical setup is:

- `Mall CCTV A`: wide mall entrance or lobby footage.
- `Mall CCTV B`: corridor, escalator, or exit-side footage.
- Optional: use the same physical video for multiple logical cameras only when demonstrating software workflow, and explain this limitation.

The app stores each upload and each analysis job separately, so replacing the demo video later does not require code changes. The recommended demo length is 10-60 seconds so YOLOv8 processing completes in class hardware time.

## Privacy Scope

The prototype performs anonymous pedestrian flow analytics. It stores anonymous track IDs, bounding boxes, zone names, trajectory points, and aggregate analytics. It does not implement face recognition, identity matching, biometric enrollment, or personal identification.

If real venue footage is used, blur or avoid close-up identifiable faces where possible, keep the video for academic demonstration only, and document that production privacy/compliance review is future work.

## Performance Notes

Processing speed depends on hardware, model size, video resolution, and video length. On the current demo environment, short 720p mall footage is processed in tens of seconds. The system records processing status and job timestamps, and the report/demo should describe:

- video length and resolution,
- hardware used,
- processing duration,
- detection/tracking limitations,
- whether the source is uploaded video or a real stream.

## Real Multicamera Processing Workflow

Use this flow for the report/demo when you want results produced from an actual video:

1. Log in as admin or operator.
2. Open `Sources`.
3. Create one camera source for each physical/logical camera, for example `Mall CCTV A`, `Mall CCTV B`.
4. Select the camera in the top camera dropdown.
5. Open `System`.
6. Generate the zone grid, rename zones, set thresholds, and save zones. Use `Report Zone Preset` for the 2 x 2 capstone layout: `Entrance`, `Lobby`, `Escalator`, `Exit`. Zones are stored per camera.
7. Return to the top upload control.
8. Keep the intended camera selected and upload an `.mp4` video.
9. Wait for processing to finish. The backend runs:

```text
extract_preview.py -> tracking.py -> analytics.py -> heatmap.py
```

10. Open `Dashboard` and `Analytics` to view camera-specific stats, heatmap, alerts, transition flow, and report export.

The current tested real-video camera is:

```text
Mall CCTV A
```

Latest real video processing result:

```text
Total people: 136
Peak zone: Lobby
Popular path: Lobby -> Exit
```

## Realtime Dashboard Behavior

After a processed video is available, the dashboard keeps the aggregate charts stable and updates the KPI cards from `/api/stats/realtime` while the processed video is playing. The endpoint maps the current video time to an approximate frame window and reads `trajectory_points` from PostgreSQL.

## Multicamera Media Storage

Each completed analysis job stores its own processed media under:

```text
backend/public/media/jobs/<job_id>/
```

The dashboard reads the latest completed job for the selected camera and loads that job's `processed.mp4`, `heatmap.png`, and `preview.jpg`. This prevents one camera upload from overwriting another camera's visible result.

## Report Use Case Coverage

The current prototype maps to the report use cases as follows:

- `UC-01 Manage Accounts`: Users tab for creating accounts, changing roles, and activating/deactivating users.
- `UC-02 Login`: Role-based login with admin/operator/analyst accounts.
- `UC-03 Manage Video/Camera Sources`: Sources tab for camera metadata and video upload.
- `UC-04 Configure Zones`: System tab with grid/preset zones, zone type, normalized coordinates, and thresholds per camera.
- `UC-05 Run Analysis Job`: Upload/reprocess pipeline with stored job history.
- `UC-06 View Dashboard`: KPI cards, realtime video-window stats, charts, and status cards.
- `UC-07 View Heatmap`: Per-job heatmap preview and full modal.
- `UC-08 View Transition Flow`: Transition list and job detail transition matrix.
- `UC-09 Configure Alert Threshold`: Per-zone thresholds plus alert management/acknowledgement.
- `UC-10 Export Report`: CSV export, printable HTML report, and backend PDF report with KPI summary, zone counts, transitions, dwell time, density score, and timeline.

## Testing

With the server running, execute:

```bash
npm run test:api
```

The smoke test covers invalid login, valid login, camera creation, zone persistence, and multicamera overview. If a completed analysis job exists, it also checks latest stats, job detail analytics, CSV report export, and PDF report export. On a fresh clone, upload `sample_data/mall.mp4` first when you want to exercise the video/report checks.

## Demonstration Checklist

1. Log in as `admin@flowai.local / admin123`.
2. Open `Sources` to register or update a camera source and status.
3. Select `Mall CCTV A` in the top camera selector.
4. Open `System`, apply `Report Zone Preset`, edit zone names/types/thresholds if needed, then save.
5. Upload or reprocess a pedestrian video.
6. Open `Dashboard` to view the processed video and heatmap for the selected camera/job.
7. Open `Multicam` to compare camera sources and jump to a camera's latest job.
8. Open `Jobs`, click a historical job, then `View On Dashboard` to load that exact job's media.
9. Open `Alerts` to acknowledge threshold breaches.
10. Open `Reports` to export CSV, open the printable report, or download PDF.
