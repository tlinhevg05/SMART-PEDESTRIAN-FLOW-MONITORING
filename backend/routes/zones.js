const express = require("express");

const fs = require("fs");

const router = express.Router();
const { pool } = require("../config/db");
const { authenticate, authorize } = require("../services/authService");

// =====================================
// SAVE ZONES
// =====================================

router.post("/zones", authenticate, authorize("admin", "operator"), async (req, res) => {

    try {

        const zones =
            req.body;

        const cameraSourceId =
            zones.camera_source_id || zones.cameraSourceId || null;

        fs.writeFileSync(

            "backend/outputs/zones.json",

            JSON.stringify(
                zones,
                null,
                4
            )
        );

        if (cameraSourceId) {

            await pool.query(
                `DELETE FROM zones WHERE camera_source_id = $1`,
                [cameraSourceId]
            );

            for (const zone of zones.zones || []) {

                await pool.query(
                    `
                    INSERT INTO zones
                    (camera_source_id, zone_name, zone_type, grid_position, grid_size, coordinates, threshold)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `,
                    [
                        cameraSourceId,
                        zone.name,
                        zone.type || zone.zone_type || "monitoring",
                        zone.grid_position,
                        zones.grid_size,
                        JSON.stringify(zone.coordinates || []),
                        zone.threshold || zones.threshold || 10
                    ]
                );
            }
        }

        return res.json({

            message:
                "Zones saved successfully"
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({

            error:
                "Failed to save zones"
        });
    }
});

// =====================================
// GET ZONES
// =====================================

router.get("/zones", authenticate, async (req, res) => {

    try {
        const cameraSourceId = req.query.camera_source_id;

        if (cameraSourceId) {
            const result = await pool.query(
                `
                SELECT id, zone_name AS name, zone_type AS type,
                       grid_position, grid_size, coordinates, threshold
                FROM zones
                WHERE camera_source_id = $1
                ORDER BY grid_position
                `,
                [cameraSourceId]
            );

            return res.json(result.rows);
        }

        const file =
            "backend/outputs/zones.json";

        if (!fs.existsSync(file)) {

            return res.json([]);
        }

        const data =
            JSON.parse(

                fs.readFileSync(file)
            );

        return res.json(data);

    } catch (err) {

        console.error(err);

        return res.status(500).json({

            error:
                "Failed to load zones"
        });
    }
});

module.exports = router;
