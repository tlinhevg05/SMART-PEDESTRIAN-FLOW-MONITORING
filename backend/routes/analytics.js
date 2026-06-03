const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

router.get("/stats", (req, res) => {

    const statsPath = path.join(
        __dirname,
        "../outputs/stats.json"
    );

    fs.readFile(statsPath, "utf8", (err, data) => {

        if (err) {
            return res.status(500).json({
                error: "Cannot read stats"
            });
        }

        res.json(JSON.parse(data));
    });
});

module.exports = router;
