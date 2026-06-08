const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const csvParser = require("csv-parser");
const { execFile } = require("child_process");
const { promisify } = require("util");

const analyticsRoutes = require("./routes/analytics");
const zonesRoutes = require("./routes/zones");
const authRoutes = require("./routes/auth");
const camerasRoutes = require("./routes/cameras");
const reportsRoutes = require("./routes/reports");
const demoRoutes = require("./routes/demo");
const { pool, initDatabase } = require("./config/db");
const { authenticate, authorize, seedDefaultUsers } = require("./services/authService");

const execFileAsync = promisify(execFile);
const app = express();
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

const ROOT_DIR = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");
const PUBLIC_DIR = path.join(__dirname, "public");
const CURRENT_CONTEXT_PATH = path.join(OUTPUT_DIR, "current_context.json");

for (const directory of [UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR]) {
    fs.mkdirSync(directory, {
        recursive: true
    });
}

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.use("/api", authRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", zonesRoutes);
app.use("/api", camerasRoutes);
app.use("/api", reportsRoutes);
app.use("/api", demoRoutes);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("video/")) {
            return cb(new Error("Unsupported video file"));
        }

        cb(null, true);
    }
});

async function runPython(script, args = []) {
    const scriptPath = path.join(ROOT_DIR, "ai_services", script);
    const { stdout, stderr } = await execFileAsync(PYTHON_BIN, [scriptPath, ...args], {
        cwd: ROOT_DIR,
        timeout: 1000 * 60 * 30
    });

    if (stdout) {
        console.log(stdout);
    }

    if (stderr) {
        console.error(stderr);
    }
}

async function getLatestZones(cameraSourceId) {
    if (cameraSourceId) {
        const result = await pool.query(
            `
            SELECT zone_name, zone_type, grid_position, grid_size, coordinates, threshold
            FROM zones
            WHERE camera_source_id = $1
            ORDER BY grid_position
            `,
            [cameraSourceId]
        );

        return result.rows;
    }

    const zoneFile = path.join(OUTPUT_DIR, "zones.json");

    if (!fs.existsSync(zoneFile)) {
        return [];
    }

    const zoneData = JSON.parse(fs.readFileSync(zoneFile, "utf8"));

    return (zoneData.zones || []).map(zone => ({
        zone_name: zone.name,
        zone_type: zone.type || zone.zone_type || "monitoring",
        grid_position: zone.grid_position,
        grid_size: zoneData.grid_size,
        coordinates: zone.coordinates || [],
        threshold: zone.threshold || zoneData.threshold || 10
    }));
}

function writeRuntimeZonesFile(cameraSourceId, zones) {
    fs.writeFileSync(
        path.join(OUTPUT_DIR, "zones.json"),
        JSON.stringify({
            camera_source_id: cameraSourceId || null,
            grid_size: zones[0]?.grid_size || 1,
            zones: zones.map(zone => ({
                name: zone.zone_name,
                type: zone.zone_type || "monitoring",
                grid_position: zone.grid_position,
                coordinates: zone.coordinates || [],
                threshold: zone.threshold || 10
            }))
        }, null, 2)
    );
}

function publicUrlFor(filePath) {
    return `/${path.relative(PUBLIC_DIR, filePath).split(path.sep).join("/")}`;
}

function copyLatestMedia(mediaPaths) {
    fs.copyFileSync(mediaPaths.processedVideoPath, path.join(PUBLIC_DIR, "processed.mp4"));
    fs.copyFileSync(mediaPaths.heatmapPath, path.join(PUBLIC_DIR, "heatmap.png"));
    fs.copyFileSync(mediaPaths.previewPath, path.join(PUBLIC_DIR, "preview.jpg"));
}

async function saveStatsToJob(jobId, zones, statsPath, mediaUrls) {
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
    const densityScores = {};

    for (const zone of zones) {
        const zoneName = zone.zone_name;
        const actualCount = Number((stats.zone_counts || {})[zoneName] || 0);
        const threshold = Math.max(1, Number(zone.threshold || 10));
        densityScores[zoneName] = Number((actualCount / threshold).toFixed(2));
    }

    await pool.query(
        `
        UPDATE analysis_jobs
        SET status = 'completed',
            total_people = $1,
            most_crowded_zone = $2,
            popular_path = $3,
            zone_counts = $4,
            transitions = $5,
            timeline = $6,
            dwell_times = $7,
            density_scores = $8,
            congestion_alert = $9,
            processed_video_path = $10,
            heatmap_path = $11,
            preview_path = $12,
            finished_at = NOW()
        WHERE id = $13
        `,
        [
            stats.total_people || 0,
            stats.most_crowded_zone || "-",
            stats.popular_path || "No movement",
            JSON.stringify(stats.zone_counts || {}),
            JSON.stringify(stats.transitions || {}),
            JSON.stringify(stats.timeline || []),
            JSON.stringify(stats.dwell_times || {}),
            JSON.stringify(densityScores),
            stats.congestion_alert || "Normal",
            mediaUrls.processedVideoUrl,
            mediaUrls.heatmapUrl,
            mediaUrls.previewUrl,
            jobId
        ]
    );

    await pool.query(
        `DELETE FROM alerts WHERE analysis_job_id = $1`,
        [jobId]
    );

    await pool.query(
        `DELETE FROM zone_counts WHERE analysis_job_id = $1`,
        [jobId]
    );

    await pool.query(
        `DELETE FROM flow_records WHERE analysis_job_id = $1`,
        [jobId]
    );

    for (const zone of zones) {
        const zoneName = zone.zone_name;
        const actualCount = Number((stats.zone_counts || {})[zoneName] || 0);
        const threshold = Number(zone.threshold || 10);

        await pool.query(
            `
            INSERT INTO zone_counts (analysis_job_id, zone_name, people_count)
            VALUES ($1, $2, $3)
            `,
            [jobId, zoneName, actualCount]
        );

        if (actualCount > threshold) {
            const severity = actualCount > threshold * 1.5 ? "danger" : "warning";
            const message = `${zoneName} exceeded threshold ${threshold} with ${actualCount} pedestrians`;

            await pool.query(
                `
                INSERT INTO alerts
                (analysis_job_id, zone_name, threshold, actual_count, severity, message)
                VALUES ($1, $2, $3, $4, $5, $6)
                `,
                [jobId, zoneName, threshold, actualCount, severity, message]
            );
        }
    }

    for (const [transition, count] of Object.entries(stats.transitions || {})) {
        const [fromZone, toZone] = transition.split(" → ");

        if (fromZone && toZone) {
            await pool.query(
                `
                INSERT INTO flow_records
                (analysis_job_id, from_zone, to_zone, transition_count)
                VALUES ($1, $2, $3, $4)
                `,
                [jobId, fromZone, toZone, Number(count)]
            );
        }
    }

    return stats;
}

async function persistTrajectoryPoints(jobId, csvPath) {
    if (!fs.existsSync(csvPath)) {
        return;
    }

    await pool.query(
        `
        DELETE FROM pedestrian_tracks
        WHERE analysis_job_id = $1
        `,
        [jobId]
    );

    const rows = await new Promise((resolve, reject) => {
        const parsedRows = [];

        fs.createReadStream(csvPath)
            .pipe(csvParser())
            .on("data", row => parsedRows.push(row))
            .on("end", () => resolve(parsedRows))
            .on("error", reject);
    });

    const byPerson = new Map();

    for (const row of rows) {
        const personId = Number(row.person_id);

        if (!byPerson.has(personId)) {
            byPerson.set(personId, []);
        }

        byPerson.get(personId).push(row);
    }

    for (const [personId, points] of byPerson.entries()) {
        const frames = points.map(point => Number(point.frame));
        const trackResult = await pool.query(
            `
            INSERT INTO pedestrian_tracks
            (analysis_job_id, anonymous_track_id, start_frame, end_frame)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            `,
            [jobId, personId, Math.min(...frames), Math.max(...frames)]
        );

        const trackId = trackResult.rows[0].id;

        for (const point of points) {
            await pool.query(
                `
                INSERT INTO trajectory_points
                (pedestrian_track_id, frame_index, x, y, zone_name)
                VALUES ($1, $2, $3, $4, $5)
                `,
                [
                    trackId,
                    Number(point.frame),
                    Number(point.x),
                    Number(point.y),
                    point.zone
                ]
            );
        }
    }
}

async function processVideo({ videoId, videoPath, cameraSourceId }) {
    const zones = await getLatestZones(cameraSourceId);

    writeRuntimeZonesFile(cameraSourceId, zones);

    const jobResult = await pool.query(
        `
        INSERT INTO analysis_jobs (video_id, camera_source_id, status, started_at)
        VALUES ($1, $2, 'processing', NOW())
        RETURNING id
        `,
        [videoId, cameraSourceId || null]
    );

    const jobId = jobResult.rows[0].id;
    const mediaDir = path.join(PUBLIC_DIR, "media", "jobs", String(jobId));
    fs.mkdirSync(mediaDir, {
        recursive: true
    });

    const mediaPaths = {
        previewPath: path.join(mediaDir, "preview.jpg"),
        processedVideoPath: path.join(mediaDir, "processed.mp4"),
        heatmapPath: path.join(mediaDir, "heatmap.png"),
        trajectoryPath: path.join(mediaDir, "trajectories.csv"),
        statsPath: path.join(mediaDir, "stats.json")
    };

    const mediaUrls = {
        previewUrl: publicUrlFor(mediaPaths.previewPath),
        processedVideoUrl: publicUrlFor(mediaPaths.processedVideoPath),
        heatmapUrl: publicUrlFor(mediaPaths.heatmapPath)
    };

    try {
        await runPython("extract_preview.py", [videoPath, mediaPaths.previewPath]);
        await runPython("tracking.py", [
            videoPath,
            mediaPaths.processedVideoPath,
            mediaPaths.trajectoryPath
        ]);
        await runPython("analytics.py", [
            mediaPaths.trajectoryPath,
            mediaPaths.statsPath
        ]);
        await runPython("heatmap.py", [
            mediaPaths.trajectoryPath,
            mediaPaths.processedVideoPath,
            mediaPaths.heatmapPath
        ]);
        await persistTrajectoryPoints(jobId, mediaPaths.trajectoryPath);

        const stats = await saveStatsToJob(jobId, zones, mediaPaths.statsPath, mediaUrls);
        copyLatestMedia(mediaPaths);

        await pool.query(
            `
            UPDATE videos
            SET status = 'completed', processed_at = NOW()
            WHERE id = $1
            `,
            [videoId]
        );

        return {
            jobId,
            stats
        };
    } catch (err) {
        await pool.query(
            `
            UPDATE analysis_jobs
            SET status = 'failed', error_message = $1, finished_at = NOW()
            WHERE id = $2
            `,
            [err.message, jobId]
        );

        await pool.query(
            `
            UPDATE videos
            SET status = 'failed'
            WHERE id = $1
            `,
            [videoId]
        );

        throw err;
    }
}

app.post("/upload", authenticate, authorize("admin"), upload.single("video"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: "No file uploaded"
            });
        }

        const cameraSourceId = req.body.cameraSourceId || req.body.camera_source_id || null;
        const videoPath = req.file.path;

        if (cameraSourceId) {
            await pool.query(
                `DELETE FROM zones WHERE camera_source_id = $1`,
                [cameraSourceId]
            );
        }

        const videoResult = await pool.query(
            `
            INSERT INTO videos (camera_source_id, filename, original_name, path, status)
            VALUES ($1, $2, $3, $4, 'uploaded')
            RETURNING id
            `,
            [cameraSourceId, req.file.filename, req.file.originalname, videoPath]
        );

        const videoId = videoResult.rows[0].id;

        fs.writeFileSync(
            CURRENT_CONTEXT_PATH,
            JSON.stringify({
                videoId,
                videoPath,
                cameraSourceId
            }, null, 2)
        );

        const result = await processVideo({
            videoId,
            videoPath,
            cameraSourceId
        });

        res.json({
            message: "Processing completed",
            ...result
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: err.message || "Processing failed"
        });
    }
});

app.post("/api/reprocess", authenticate, authorize("admin"), async (req, res) => {
    try {
        let context = null;
        const cameraSourceId = req.body?.cameraSourceId || req.body?.camera_source_id || null;

        if (cameraSourceId) {
            const videoResult = await pool.query(
                `
                SELECT id, path
                FROM videos
                WHERE camera_source_id = $1
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                `,
                [cameraSourceId]
            );
            const video = videoResult.rows[0];

            if (!video) {
                return res.status(400).json({
                    error: "No uploaded video is available for this camera"
                });
            }

            context = {
                videoId: video.id,
                videoPath: video.path,
                cameraSourceId
            };
        } else if (fs.existsSync(CURRENT_CONTEXT_PATH)) {
            context = JSON.parse(fs.readFileSync(CURRENT_CONTEXT_PATH, "utf8"));
        }

        if (!context) {
            return res.status(400).json({
                error: "No uploaded video is available"
            });
        }

        const result = await processVideo(context);

        res.json({
            message: "Reprocessed",
            ...result
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: err.message || "Reprocess failed"
        });
    }
});

app.use((err, req, res, next) => {
    if (err) {
        return res.status(400).json({
            error: err.message || "Request failed"
        });
    }

    next();
});

const PORT = process.env.PORT || 3000;

async function start() {
    await initDatabase();
    await seedDefaultUsers();

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

start().catch(err => {
    console.error("Server startup failed:", err);
    process.exit(1);
});
