const express = require("express");
const { pool } = require("../config/db");
const { authenticate, authorize } = require("../services/authService");

const router = express.Router();

router.get("/cameras", authenticate, async (req, res) => {
    const result = await pool.query(
        `
        SELECT id, name, location, description, status, created_at
        FROM camera_sources
        ORDER BY id DESC
        `
    );

    res.json(result.rows);
});

router.post("/cameras", authenticate, authorize("admin"), async (req, res) => {
    try {
        const { name, location, description, status } = req.body;

        if (!name) {
            return res.status(400).json({
                error: "Camera name is required"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO camera_sources (name, location, description, status)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, location, description, status, created_at
            `,
            [name, location || "", description || "", status || "active"]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Create camera source failed"
        });
    }
});

router.patch("/cameras/:id", authenticate, authorize("admin"), async (req, res) => {
    try {
        const cameraId = Number(req.params.id);
        const { name, location, description, status } = req.body;

        const result = await pool.query(
            `
            UPDATE camera_sources
            SET name = COALESCE($1, name),
                location = COALESCE($2, location),
                description = COALESCE($3, description),
                status = COALESCE($4, status)
            WHERE id = $5
            RETURNING id, name, location, description, status, created_at
            `,
            [
                name || null,
                location ?? null,
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

router.delete("/cameras/:id", authenticate, authorize("admin"), async (req, res) => {
    try {
        const result = await pool.query(
            `
            DELETE FROM camera_sources
            WHERE id = $1
            RETURNING id
            `,
            [Number(req.params.id)]
        );

        if (!result.rows[0]) {
            return res.status(404).json({
                error: "Camera source not found"
            });
        }

        res.json({
            message: "Camera source deleted"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Delete camera source failed"
        });
    }
});

module.exports = router;
