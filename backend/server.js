
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const { exec } = require("child_process");

const analyticsRoutes =
    require("./routes/analytics");

const zonesRoutes =
    require("./routes/zones");

const app = express();

const fs = require("fs");

// =========================
// RESET OLD FILES
// =========================

const filesToDelete = [

    "backend/public/processed.mp4",

    "backend/public/heatmap.png",

    "backend/outputs/trajectories.csv",

    "backend/outputs/stats.json"
];


filesToDelete.forEach((file) => {

    if (fs.existsSync(file)) {

        fs.unlinkSync(file);

        console.log(
            `Deleted: ${file}`
        );
    }
});

// =========================
// MIDDLEWARE
// =========================

app.use(cors());

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

app.use("/api", analyticsRoutes);

app.use("/api", zonesRoutes);

// =========================
// MULTER STORAGE
// =========================

const storage = multer.diskStorage({

    destination: function (
        req,
        file,
        cb
    ) {

        cb(
            null,
            "backend/uploads/"
        );
    },

    filename: function (
        req,
        file,
        cb
    ) {

        cb(
            null,
            Date.now() +
            "-" +
            file.originalname
        );
    }
});

const upload = multer({
    storage: storage
});

// =========================
// UPLOAD ROUTE
// =========================

app.post(

    "/upload",

    upload.single("video"),

    (req, res) => {

        if (!req.file) {

            return res.status(400).json({

                error:
                    "No file uploaded"
            });
        }

        const videoPath =
            `backend/uploads/${req.file.filename}`;
        fs.writeFileSync(
            "backend/outputs/current_video.txt",
            videoPath
        );
        exec(
            `python ai_services/extract_preview.py "${videoPath}"`,
            (err, stdout, stderr) => {

                if (err) {

                    console.error(err);

                } else {

                    console.log(stdout);
                }
            }
        );

        console.log(
            "Processing video..."
        );

        // =========================
        // TRACKING
        // =========================

        exec(

            `python ai_services/tracking.py "${videoPath}"`,

            (
                error,
                stdout,
                stderr
            ) => {

                if (error) {

                    console.error(error);

                    return res.status(500).json({

                        error:
                            "Tracking failed"
                    });
                }

                console.log(stdout);

                // =========================
                // ANALYTICS
                // =========================

                exec(

                    `python ai_services/analytics.py`,

                    (
                        err2,
                        stdout2,
                        stderr2
                    ) => {

                        if (err2) {

                            console.error(err2);

                            return res.status(500).json({

                                error:
                                    "Analytics failed"
                            });
                        }

                        console.log(stdout2);

                        // =========================
                        // HEATMAP
                        // =========================

                        exec(

                            `python ai_services/heatmap.py`,

                            (
                                err3,
                                stdout3,
                                stderr3
                            ) => {

                                if (err3) {

                                    console.error(err3);

                                    return res.status(500).json({

                                        error:
                                            "Heatmap failed"
                                    });
                                }

                                console.log(stdout3);

                                // =========================
                                // FINAL RESPONSE
                                // =========================

                                return res.json({

                                    message:
                                        "Processing completed"
                                });
                            }
                        );
                    }
                );
            }
        );
    }
);
app.post(
    "/api/reprocess",
    (req, res) => {

        const videoPath =
            fs.readFileSync(
                "backend/outputs/current_video.txt",
                "utf8"
            ).trim();

        exec(
            `python ai_services/tracking.py "${videoPath}"`,
            (err) => {

                if (err) {

                    return res
                        .status(500)
                        .json({
                            error:
                                "Tracking failed"
                        });
                }

                exec(
                    `python ai_services/analytics.py`,
                    (err2) => {

                        if (err2) {

                            return res
                                .status(500)
                                .json({
                                    error:
                                        "Analytics failed"
                                });
                        }

                        exec(
                            `python ai_services/heatmap.py`,
                            (err3) => {

                                if (err3) {

                                    return res
                                        .status(500)
                                        .json({
                                            error:
                                                "Heatmap failed"
                                        });
                                }

                                res.json({
                                    message:
                                        "Reprocessed"
                                });
                            }
                        );
                    }
                );
            }
        );
    }
);
// =========================
// SERVER
// =========================

const PORT = 3000;

app.listen(PORT, () => {

    console.log(
        `Server running on port ${PORT}`
    );
});
