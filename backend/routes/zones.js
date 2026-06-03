const express = require("express");

const fs = require("fs");

const router = express.Router();

// =====================================
// SAVE ZONES
// =====================================

router.post("/zones", (req, res) => {

    try {

        const zones =
            req.body;

        fs.writeFileSync(

            "backend/outputs/zones.json",

            JSON.stringify(
                zones,
                null,
                4
            )
        );

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

router.get("/zones", (req, res) => {

    try {

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