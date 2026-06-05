const { pool } = require("../config/db");

// =====================================
// SAVE ZONES (OPTIMIZED)
// =====================================
async function saveZones(videoId, gridSize, zones) {

    // delete old zones first
    await pool.query(
        `DELETE FROM zones WHERE video_id = $1`,
        [videoId]
    );

    if (!zones || zones.length === 0) return;

    // batch insert (FAST)
    const values = [];
    const params = [];

    let idx = 1;

    for (const zone of zones) {
        values.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );

        params.push(
            videoId,
            zone.name,
            zone.grid_position,
            gridSize
        );
    }

    await pool.query(
        `
        INSERT INTO zones
        (video_id, zone_name, grid_position, grid_size)
        VALUES ${values.join(",")}
        `,
        params
    );
}

// =====================================
// GET ZONES
// =====================================
async function getZones(videoId) {

    const result = await pool.query(
        `
        SELECT *
        FROM zones
        WHERE video_id = $1
        ORDER BY grid_position
        `,
        [videoId]
    );

    return result.rows;
}

// =====================================
// DELETE ZONES
// =====================================
async function deleteZones(videoId) {

    await pool.query(
        `DELETE FROM zones WHERE video_id = $1`,
        [videoId]
    );
}

module.exports = {
    saveZones,
    getZones,
    deleteZones
};
