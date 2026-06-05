const express = require("express");
const { pool } = require("../config/db");
const { authenticate, authorize } = require("../services/authService");

const router = express.Router();

router.get("/cameras", authenticate, async (req, res) => {
    const result = await pool.query(
        `
        SELECT id, name, location, stream_url, description, status, created_at
        FROM camera_sources
        ORDER BY id DESC
        `
    );

    res.json(result.rows);
});

router.post("/cameras", authenticate, authorize("admin", "operator"), async (req, res) => {
    try {
        const { name, location, streamUrl, description, status } = req.body;

        if (!name) {
            return res.status(400).json({
                error: "Camera name is required"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO camera_sources (name, location, stream_url, description, status)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, name, location, stream_url, description, status, created_at
            `,
            [name, location || "", streamUrl || "", description || "", status || "active"]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Create camera source failed"
        });
    }
});

router.patch("/cameras/:id", authenticate, authorize("admin", "operator"), async (req, res) => {
    try {
        const cameraId = Number(req.params.id);
        const { name, location, streamUrl, description, status } = req.body;

        const result = await pool.query(
            `
            UPDATE camera_sources
            SET name = COALESCE($1, name),
                location = COALESCE($2, location),
                stream_url = COALESCE($3, stream_url),
                description = COALESCE($4, description),
                status = COALESCE($5, status)
            WHERE id = $6
            RETURNING id, name, location, stream_url, description, status, created_at
            `,
            [
                name || null,
                location ?? null,
                streamUrl ?? null,
                description ?? null,
                status || null,
                cameraId
            ]
        );

        if (!result.rows[0]) {
            return res.status(404).json({
                error: "Camera source not found"
            });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Update camera source failed"
        });
    }
});

module.exports = router;
