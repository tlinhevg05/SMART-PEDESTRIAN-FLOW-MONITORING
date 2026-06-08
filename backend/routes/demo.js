const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { pool } = require("../config/db");
const { authenticate, authorize } = require("../services/authService");

const router = express.Router();
const execFileAsync = promisify(execFile);

const OUTPUT_DIR = path.join(__dirname, "../outputs");
const PUBLIC_DIR = path.join(__dirname, "../public");
const ROOT_DIR = path.join(__dirname, "../..");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

async function insertTrack(jobId, anonymousTrackId, points) {
    const frames = points.map(point => point.frame);
    const trackResult = await pool.query(
        `
        INSERT INTO pedestrian_tracks
        (analysis_job_id, anonymous_track_id, start_frame, end_frame)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [jobId, anonymousTrackId, Math.min(...frames), Math.max(...frames)]
    );

    const trackId = trackResult.rows[0].id;

    for (const point of points) {
        await pool.query(
            `
            INSERT INTO trajectory_points
            (pedestrian_track_id, frame_index, x, y, zone_name)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [trackId, point.frame, point.x, point.y, point.zone]
        );
    }
}

async function generateDemoMedia() {
    const scriptPath = path.join(ROOT_DIR, "ai_services", "demo_media.py");

    try {
        await execFileAsync(PYTHON_BIN, [scriptPath], {
            cwd: ROOT_DIR,
            timeout: 1000 * 60
        });
    } catch (err) {
        console.error("Demo media generation failed:", err.message);
    }
}

router.post("/demo/seed", authenticate, authorize("admin"), async (req, res) => {
    try {
        fs.mkdirSync(OUTPUT_DIR, {
            recursive: true
        });
        fs.mkdirSync(PUBLIC_DIR, {
            recursive: true
        });

        const oldDemoVideos = await pool.query(
            `
            SELECT id
            FROM videos
            WHERE path = 'demo://synthetic'
            `
        );

        for (const video of oldDemoVideos.rows) {
            await pool.query(
                `DELETE FROM videos WHERE id = $1`,
                [video.id]
            );
        }

        await pool.query(
            `
            DELETE FROM camera_sources
            WHERE description = 'Synthetic capstone demo source'
            `
        );

        const cameraResult = await pool.query(
            `
            INSERT INTO camera_sources
            (name, location, description, status)
            VALUES ($1, $2, $3, 'active')
            RETURNING id
            `,
            [
                "Demo Camera - Main Lobby",
                "Convention hall entrance",
                "Synthetic capstone demo source"
            ]
        );
        const cameraSourceId = cameraResult.rows[0].id;

        const zones = [
            ["Entrance", 0, 8],
            ["Lobby", 1, 10],
            ["Escalator", 2, 6],
            ["Exit", 3, 8]
        ];

        for (const [name, position, threshold] of zones) {
            await pool.query(
                `
                INSERT INTO zones
                (camera_source_id, zone_name, grid_position, grid_size, threshold)
                VALUES ($1, $2, $3, 2, $4)
                `,
                [cameraSourceId, name, position, threshold]
            );
        }

        fs.writeFileSync(
            path.join(OUTPUT_DIR, "zones.json"),
            JSON.stringify({
                camera_source_id: cameraSourceId,
                grid_size: 2,
                zones: zones.map(([name, gridPosition, threshold]) => ({
                    name,
                    grid_position: gridPosition,
                    threshold
                }))
            }, null, 2)
        );

        const videoResult = await pool.query(
            `
            INSERT INTO videos
            (camera_source_id, filename, original_name, path, status, processed_at)
            VALUES ($1, $2, $3, $4, 'completed', NOW())
            RETURNING id
            `,
            [
                cameraSourceId,
                "demo-synthetic.mp4",
                "Synthetic pedestrian demo",
                "demo://synthetic"
            ]
        );
        const videoId = videoResult.rows[0].id;

        const stats = {
            total_people: 18,
            most_crowded_zone: "Escalator",
            popular_path: "Entrance → Escalator",
            zone_counts: {
                Entrance: 12,
                Lobby: 9,
                Escalator: 14,
                Exit: 7
            },
            transitions: {
                "Entrance → Lobby": 7,
                "Entrance → Escalator": 10,
                "Lobby → Exit": 5,
                "Escalator → Exit": 6
            },
            timeline: [
                { label: "0-30", count: 3 },
                { label: "30-60", count: 7 },
                { label: "60-90", count: 11 },
                { label: "90-120", count: 14 },
                { label: "120-150", count: 10 },
                { label: "150-180", count: 6 }
            ],
            congestion_alert: "High congestion in Escalator"
        };

        const jobResult = await pool.query(
            `
            INSERT INTO analysis_jobs
            (video_id, camera_source_id, status, total_people, most_crowded_zone,
             popular_path, zone_counts, transitions, timeline, congestion_alert,
             started_at, finished_at)
            VALUES ($1, $2, 'completed', $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING id
            `,
            [
                videoId,
                cameraSourceId,
                stats.total_people,
                stats.most_crowded_zone,
                stats.popular_path,
                JSON.stringify(stats.zone_counts),
                JSON.stringify(stats.transitions),
                JSON.stringify(stats.timeline),
                stats.congestion_alert
            ]
        );
        const jobId = jobResult.rows[0].id;

        for (const [zoneName, count] of Object.entries(stats.zone_counts)) {
            await pool.query(
                `
                INSERT INTO zone_counts
                (analysis_job_id, zone_name, people_count)
                VALUES ($1, $2, $3)
                `,
                [jobId, zoneName, count]
            );
        }

        for (const [transition, count] of Object.entries(stats.transitions)) {
            const [fromZone, toZone] = transition.split(" → ");
            await pool.query(
                `
                INSERT INTO flow_records
                (analysis_job_id, from_zone, to_zone, transition_count)
                VALUES ($1, $2, $3, $4)
                `,
                [jobId, fromZone, toZone, count]
            );
        }

        await pool.query(
            `
            INSERT INTO alerts
            (analysis_job_id, zone_name, threshold, actual_count, severity, message)
            VALUES ($1, 'Escalator', 6, 14, 'danger', 'Escalator exceeded threshold 6 with 14 pedestrians')
            `,
            [jobId]
        );

        await insertTrack(jobId, 1, [
            { frame: 0, x: 120, y: 200, zone: "Entrance" },
            { frame: 35, x: 260, y: 220, zone: "Lobby" },
            { frame: 72, x: 460, y: 260, zone: "Escalator" }
        ]);
        await insertTrack(jobId, 2, [
            { frame: 0, x: 130, y: 240, zone: "Entrance" },
            { frame: 45, x: 430, y: 290, zone: "Escalator" },
            { frame: 110, x: 620, y: 320, zone: "Exit" }
        ]);

        fs.writeFileSync(
            path.join(OUTPUT_DIR, "stats.json"),
            JSON.stringify(stats, null, 2)
        );
        await generateDemoMedia();

        res.json({
            message: "Demo data created",
            cameraSourceId,
            videoId,
            jobId,
            stats
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Demo data setup failed"
        });
    }
});

module.exports = router;
