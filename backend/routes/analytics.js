const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const { authenticate } = require("../services/authService");

const router = express.Router();

function normalizeZoneGeometry(rawCoordinates) {
    if (Array.isArray(rawCoordinates)) {
        return {
            shape: rawCoordinates.length === 2 ? "line" : "polygon",
            points: rawCoordinates
        };
    }

    if (rawCoordinates && Array.isArray(rawCoordinates.points)) {
        return {
            shape: rawCoordinates.shape === "line" ? "line" : "polygon",
            points: rawCoordinates.points
        };
    }

    return {
        shape: "polygon",
        points: []
    };
}

function sideOfLine(point, start, end) {
    return (
        (end.x - start.x) * (point.y - start.y) -
        (end.y - start.y) * (point.x - start.x)
    );
}

async function getTypedZoneAnalytics(job) {
    if (!job?.id || !job.camera_source_id) {
        return {
            polygon_zone_counts: job?.zone_counts || {},
            line_zone_counts: {}
        };
    }

    const zoneResult = await pool.query(
        `
        SELECT zone_name, coordinates
        FROM zones
        WHERE camera_source_id = $1
        ORDER BY grid_position
        `,
        [job.camera_source_id]
    );

    const polygonZoneCounts = {};
    const lineZones = [];

    for (const zone of zoneResult.rows) {
        const geometry = normalizeZoneGeometry(zone.coordinates);

        if (geometry.shape === "line") {
            lineZones.push({
                name: zone.zone_name,
                points: geometry.points
            });
        } else {
            polygonZoneCounts[zone.zone_name] =
                Number((job.zone_counts || {})[zone.zone_name] || 0);
        }
    }

    if (!lineZones.length) {
        return {
            polygon_zone_counts: polygonZoneCounts,
            line_zone_counts: {}
        };
    }

    const pointResult = await pool.query(
        `
        SELECT pt.anonymous_track_id, tp.frame_index, tp.x, tp.y
        FROM trajectory_points tp
        JOIN pedestrian_tracks pt
          ON pt.id = tp.pedestrian_track_id
        WHERE pt.analysis_job_id = $1
        ORDER BY pt.anonymous_track_id, tp.frame_index
        `,
        [job.id]
    );

    const maxX = Math.max(1, ...pointResult.rows.map(row => Number(row.x || 0)));
    const maxY = Math.max(1, ...pointResult.rows.map(row => Number(row.y || 0)));
    const tracks = new Map();

    for (const row of pointResult.rows) {
        const trackId = row.anonymous_track_id;

        if (!tracks.has(trackId)) {
            tracks.set(trackId, []);
        }

        tracks.get(trackId).push({
            x: Number(row.x) / maxX,
            y: Number(row.y) / maxY
        });
    }

    const lineZoneCounts = {};

    for (const lineZone of lineZones) {
        const [start, end] = lineZone.points || [];
        let crossings = 0;

        if (!start || !end) {
            lineZoneCounts[lineZone.name] = 0;
            continue;
        }

        for (const points of tracks.values()) {
            let crossed = false;

            for (let i = 1; i < points.length; i += 1) {
                const previousSide = sideOfLine(points[i - 1], start, end);
                const currentSide = sideOfLine(points[i], start, end);

                if (previousSide === 0 || currentSide === 0 || previousSide * currentSide < 0) {
                    crossed = true;
                    break;
                }
            }

            if (crossed) crossings += 1;
        }

        lineZoneCounts[lineZone.name] = crossings;
    }

    return {
        polygon_zone_counts: polygonZoneCounts,
        line_zone_counts: lineZoneCounts
    };
}

router.get("/multicamera/overview", authenticate, async (req, res) => {
    const result = await pool.query(
        `
        SELECT cs.id AS camera_source_id, cs.name, cs.location, cs.status,
               aj.id AS analysis_job_id, aj.total_people, aj.most_crowded_zone,
               aj.popular_path, aj.congestion_alert, aj.processed_video_path,
               aj.heatmap_path, aj.preview_path, aj.finished_at,
               COALESCE(open_alerts.count, 0)::int AS open_alert_count
        FROM camera_sources cs
        LEFT JOIN LATERAL (
            SELECT *
            FROM analysis_jobs
            WHERE camera_source_id = cs.id
              AND status = 'completed'
            ORDER BY finished_at DESC NULLS LAST, id DESC
            LIMIT 1
        ) aj ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS count
            FROM alerts
            WHERE analysis_job_id = aj.id
              AND status = 'open'
        ) open_alerts ON TRUE
        ORDER BY cs.id DESC
        `
    );

    res.json(result.rows);
});

router.get("/stats", authenticate, async (req, res) => {

    try {
        const cameraSourceId = req.query.camera_source_id || null;
        const jobId = req.query.job_id || null;
        const params = [];
        const filters = ["status = 'completed'"];

        if (cameraSourceId) {
            params.push(cameraSourceId);
            filters.push(`camera_source_id = $${params.length}`);
        }

        if (jobId) {
            params.push(jobId);
            filters.push(`id = $${params.length}`);
        }

        const result = await pool.query(
            `
            SELECT id, camera_source_id, total_people, most_crowded_zone, popular_path,
                   zone_counts, transitions, timeline, congestion_alert, status,
                   dwell_times, density_scores,
                   processed_video_path, heatmap_path, preview_path,
                   started_at, finished_at
            FROM analysis_jobs
            WHERE ${filters.join(" AND ")}
            ORDER BY finished_at DESC NULLS LAST, id DESC
            LIMIT 1
            `,
            params
        );

        if (result.rows[0]) {
            const typedAnalytics = await getTypedZoneAnalytics(result.rows[0]);
            return res.json({
                ...result.rows[0],
                ...typedAnalytics
            });
        }
    } catch (err) {
        console.error("Stats DB fallback:", err.message);
    }
    
    return res.status(404).json({
        error: "No completed analysis job is available"
    });
});

router.get("/stats/realtime", authenticate, async (req, res) => {
    try {
        const cameraSourceId = req.query.camera_source_id || null;
        const timeSeconds = Math.max(0, Number(req.query.time || 0));
        const fps = Math.max(1, Number(req.query.fps || 30));
        const frame = Math.floor(timeSeconds * fps);
        const frameWindow = Math.max(1, Number(req.query.window || 15));

        const params = [];
        let cameraFilter = "";

        if (cameraSourceId) {
            params.push(cameraSourceId);
            cameraFilter = `AND camera_source_id = $${params.length}`;
        }

        const latestJobResult = await pool.query(
            `
            SELECT id, popular_path
            FROM analysis_jobs
            WHERE status = 'completed'
              ${cameraFilter}
            ORDER BY finished_at DESC NULLS LAST, id DESC
            LIMIT 1
            `,
            params
        );
        const latestJob = latestJobResult.rows[0];

        if (!latestJob) {
            return res.status(404).json({
                error: "No completed analysis job is available"
            });
        }

        const result = await pool.query(
            `
            SELECT pt.anonymous_track_id, tp.zone_name
            FROM trajectory_points tp
            JOIN pedestrian_tracks pt
              ON pt.id = tp.pedestrian_track_id
            WHERE pt.analysis_job_id = $1
              AND tp.frame_index BETWEEN $2 AND $3
            `,
            [
                latestJob.id,
                Math.max(0, frame - frameWindow),
                frame + frameWindow
            ]
        );

        const people = new Set();
        const zoneCounts = {};

        for (const row of result.rows) {
            people.add(row.anonymous_track_id);
            if (!row.zone_name || row.zone_name === "Unknown") {
                continue;
            }
            zoneCounts[row.zone_name] =
                (zoneCounts[row.zone_name] || 0) + 1;
        }

        const mostCrowdedZone = Object.keys(zoneCounts).length
            ? Object.keys(zoneCounts).reduce((a, b) =>
                zoneCounts[a] >= zoneCounts[b] ? a : b
            )
            : "-";

        const maxCount = Math.max(0, ...Object.values(zoneCounts));
        let congestionAlert = "Normal";

        if (maxCount > 15) {
            congestionAlert = `High congestion in ${mostCrowdedZone}`;
        } else if (maxCount > 10) {
            congestionAlert = `Moderate traffic in ${mostCrowdedZone}`;
        }

        res.json({
            analysis_job_id: latestJob.id,
            current_frame: frame,
            total_people: people.size,
            most_crowded_zone: mostCrowdedZone,
            popular_path: latestJob.popular_path || "Realtime",
            zone_counts: zoneCounts,
            congestion_alert: congestionAlert
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Cannot load realtime stats"
        });
    }
});

router.get("/flow", authenticate, async (req, res) => {
    const cameraSourceId = req.query.camera_source_id || null;
    const params = [];
    let cameraFilter = "";

    if (cameraSourceId) {
        params.push(cameraSourceId);
        cameraFilter = `AND camera_source_id = $${params.length}`;
    }

    const result = await pool.query(
        `
        SELECT fr.from_zone, fr.to_zone, fr.transition_count
        FROM flow_records fr
        WHERE fr.analysis_job_id = (
            SELECT id
            FROM analysis_jobs
            WHERE status = 'completed'
              ${cameraFilter}
            ORDER BY finished_at DESC NULLS LAST, id DESC
            LIMIT 1
        )
        ORDER BY fr.transition_count DESC
        LIMIT 30
        `,
        params
    );

    res.json(result.rows);
});

router.get("/alerts", authenticate, async (req, res) => {
    const cameraSourceId = req.query.camera_source_id || null;
    const params = [];
    let cameraJoin = "";
    let cameraFilter = "";

    if (cameraSourceId) {
        params.push(cameraSourceId);
        cameraJoin = `JOIN analysis_jobs aj ON aj.id = alerts.analysis_job_id`;
        cameraFilter = `WHERE aj.camera_source_id = $${params.length}`;
    }

    const result = await pool.query(
        `
        SELECT alerts.id, alerts.analysis_job_id, alerts.zone_name,
               alerts.threshold, alerts.actual_count, alerts.severity,
               alerts.message, alerts.status, alerts.acknowledged_at,
               alerts.created_at
        FROM alerts
        ${cameraJoin}
        ${cameraFilter}
        ORDER BY alerts.created_at DESC
        LIMIT 50
        `,
        params
    );

    res.json(result.rows);
});

router.get("/analysis-jobs", authenticate, async (req, res) => {
    const cameraSourceId = req.query.camera_source_id || null;
    const status = req.query.status || null;
    const search = req.query.search || null;
    const params = [];
    const filters = [];

    if (cameraSourceId) {
        params.push(cameraSourceId);
        filters.push(`aj.camera_source_id = $${params.length}`);
    }

    if (status) {
        params.push(status);
        filters.push(`aj.status = $${params.length}`);
    }

    if (search) {
        params.push(`%${search}%`);
        filters.push(`(cs.name ILIKE $${params.length} OR cs.location ILIKE $${params.length} OR v.original_name ILIKE $${params.length})`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query(
        `
        SELECT aj.id, aj.video_id, aj.camera_source_id, aj.status, aj.total_people,
               aj.most_crowded_zone, aj.popular_path, aj.congestion_alert,
               aj.processed_video_path, aj.heatmap_path, aj.preview_path,
               aj.started_at, aj.finished_at, aj.created_at, aj.error_message,
               cs.name AS camera_name, cs.location AS camera_location,
               v.original_name AS video_name
        FROM analysis_jobs aj
        LEFT JOIN camera_sources cs ON cs.id = aj.camera_source_id
        LEFT JOIN videos v ON v.id = aj.video_id
        ${whereClause}
        ORDER BY aj.id DESC
        LIMIT 30
        `,
        params
    );

    res.json(result.rows);
});

router.get("/analysis-jobs/:id", authenticate, async (req, res) => {
    const jobId = Number(req.params.id);

    const jobResult = await pool.query(
        `
        SELECT aj.*, cs.name AS camera_name, cs.location AS camera_location,
               v.original_name AS video_name, v.path AS video_path
        FROM analysis_jobs aj
        LEFT JOIN camera_sources cs ON cs.id = aj.camera_source_id
        LEFT JOIN videos v ON v.id = aj.video_id
        WHERE aj.id = $1
        `,
        [jobId]
    );

    const job = jobResult.rows[0];

    if (!job) {
        return res.status(404).json({
            error: "Analysis job not found"
        });
    }

    const [zoneCounts, flows, alerts, tracks] = await Promise.all([
        pool.query(
            `SELECT zone_name, people_count FROM zone_counts WHERE analysis_job_id = $1 ORDER BY people_count DESC`,
            [jobId]
        ),
        pool.query(
            `SELECT from_zone, to_zone, transition_count FROM flow_records WHERE analysis_job_id = $1 ORDER BY transition_count DESC`,
            [jobId]
        ),
        pool.query(
            `SELECT id, zone_name, threshold, actual_count, severity, message, status, created_at, acknowledged_at FROM alerts WHERE analysis_job_id = $1 ORDER BY created_at DESC`,
            [jobId]
        ),
        pool.query(
            `SELECT COUNT(*)::int AS track_count, MIN(start_frame) AS first_frame, MAX(end_frame) AS last_frame FROM pedestrian_tracks WHERE analysis_job_id = $1`,
            [jobId]
        )
    ]);

    res.json({
        ...job,
        zone_count_rows: zoneCounts.rows,
        flow_rows: flows.rows,
        alerts: alerts.rows,
        track_summary: tracks.rows[0]
    });
});

router.patch("/alerts/:id/acknowledge", authenticate, async (req, res) => {
    const result = await pool.query(
        `
        UPDATE alerts
        SET status = 'acknowledged',
            acknowledged_by = $1,
            acknowledged_at = NOW()
        WHERE id = $2
        RETURNING id, analysis_job_id, zone_name, threshold, actual_count,
                  severity, message, status, acknowledged_at, created_at
        `,
        [req.user.id, Number(req.params.id)]
    );

    if (!result.rows[0]) {
        return res.status(404).json({
            error: "Alert not found"
        });
    }

    res.json(result.rows[0]);
});

module.exports = router;
