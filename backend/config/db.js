const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "flowai"
});

async function initDatabase() {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    await pool.query(schema);
}

pool.connect()
    .then(client => {
        client.release();
        console.log("PostgreSQL Connected");
    })
    .catch(err => {
        console.error("Database Error:", err.message);
    });

module.exports = {
    pool,
    initDatabase
};
