const { Pool } = require("pg");

const pool = new Pool({

    host: "localhost",
    port: 5432,

    user: "postgres",

    password: "postgres",

    database: "flowai"
});

pool.connect()
    .then(() => {

        console.log(
            "PostgreSQL Connected"
        );

    })
    .catch(err => {

        console.error(
            "Database Error:",
            err
        );

    });

module.exports = pool;