const express = require("express");
const { authenticate, authorize, hashPassword, login } = require("../services/authService");
const { pool } = require("../config/db");

const router = express.Router();

router.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        const session = await login(email, password);

        if (!session) {
            return res.status(401).json({
                error: "Invalid credentials"
            });
        }

        res.json(session);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Login failed"
        });
    }
});

router.post("/auth/register", async (req, res) => {
    try {
        const { fullName, email, password } = req.body || {};
        const accountRole = "staff";

        if (!fullName || !email || !password) {
            return res.status(400).json({
                error: "Full name, email, and password are required"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO users (full_name, email, password_hash, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, full_name, email, role, status, created_at
            `,
            [fullName, email, hashPassword(password), accountRole]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === "23505") {
            return res.status(409).json({
                error: "Email is already registered"
            });
        }

        console.error(err);
        res.status(500).json({
            error: "Create account failed"
        });
    }
});

router.get("/auth/me", authenticate, (req, res) => {
    res.json(req.user);
});

router.get("/users", authenticate, authorize("admin"), async (req, res) => {
    const result = await pool.query(
        `
        SELECT id, full_name, email, role, status, created_at
        FROM users
        ORDER BY id
        `
    );

    res.json(result.rows);
});

router.post("/users", authenticate, authorize("admin"), async (req, res) => {
    try {
        const { fullName, email, password, role } = req.body;
        const userRole = ["admin", "analyst", "staff"].includes(role)
            ? role
            : "staff";

        if (!fullName || !email || !password || !role) {
            return res.status(400).json({
                error: "Missing required user fields"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO users (full_name, email, password_hash, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, full_name, email, role, status, created_at
            `,
            [fullName, email, hashPassword(password), userRole]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Create user failed"
        });
    }
});

router.patch("/users/:id", authenticate, authorize("admin"), async (req, res) => {
    try {
        const userId = Number(req.params.id);
        const { fullName, email, password, role, status } = req.body;

        const current = await pool.query(
            `SELECT id FROM users WHERE id = $1`,
            [userId]
        );

        if (!current.rows[0]) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        const updates = [];
        const params = [];

        if (fullName) {
            params.push(fullName);
            updates.push(`full_name = $${params.length}`);
        }

        if (email) {
            params.push(email);
            updates.push(`email = $${params.length}`);
        }

        if (password) {
            params.push(hashPassword(password));
            updates.push(`password_hash = $${params.length}`);
        }

        if (role) {
            params.push(role);
            updates.push(`role = $${params.length}`);
        }

        if (status) {
            params.push(status);
            updates.push(`status = $${params.length}`);
        }

        if (!updates.length) {
            return res.status(400).json({
                error: "No user fields to update"
            });
        }

        params.push(userId);

        const result = await pool.query(
            `
            UPDATE users
            SET ${updates.join(", ")}
            WHERE id = $${params.length}
            RETURNING id, full_name, email, role, status, created_at
            `,
            params
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Update user failed"
        });
    }
});

module.exports = router;
