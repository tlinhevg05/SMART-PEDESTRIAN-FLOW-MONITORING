const { pool } = require("../config/db");

// =====================================
// GET ANALYTICS BY VIDEO ID
// =====================================
async function getAnalytics(videoId) {

    const result = await pool.query(
        `
        SELECT *
        FROM analytics
        WHERE video_id = $1
        `,
        [videoId]
    );

    return result.rows[0];
}

// =====================================
// GET LATEST (optional fallback)

async function getLatestAnalytics() {

    const result = await pool.query(
        `
        SELECT *
        FROM analytics
        ORDER BY video_id DESC
        LIMIT 1
        `
    );

    return result.rows[0];
}

module.exports = {
    getAnalytics,
    getLatestAnalytics
};
