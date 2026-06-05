const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const { authenticate } = require("../services/authService");

const router = express.Router();

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
            SELECT id, total_people, most_crowded_zone, popular_path,
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
            return res.json(result.rows[0]);
        }
    } catch (err) {
        console.error("Stats DB fallback:", err.message);
    }

    const statsPath = path.join(
        __dirname,
        "../outputs/stats.json"
    );

    fs.readFile(statsPath, "utf8", (err, data) => {

        if (err) {
            return res.status(500).json({
                error: "Cannot read stats"
            });
        }

        res.json(JSON.parse(data));
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
