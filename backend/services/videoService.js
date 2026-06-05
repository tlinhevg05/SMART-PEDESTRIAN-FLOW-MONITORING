const { pool } =
    require("../config/db");

async function createVideo(
    filename
) {

    const query = `

        INSERT INTO videos
        (
            filename
        )

        VALUES
        (
            $1
        )

        RETURNING id

    `;

    const result =
        await pool.query(

            query,

            [
                filename
            ]
        );

    return result.rows[0];
}

async function markProcessed(
    videoId
) {

    await pool.query(

        `
        UPDATE videos
        SET processed = TRUE
        WHERE id = $1
        `,

        [
            videoId
        ]
    );
}

module.exports = {

    createVideo,

    markProcessed
};
