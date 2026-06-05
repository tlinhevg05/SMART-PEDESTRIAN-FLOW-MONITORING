const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3001";

async function request(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

    return {
        response,
        body
    };
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function run() {
    const results = [];
    const state = {
        token: "",
        cameraId: null,
        completedJobId: null
    };

    const record = async (name, fn) => {
        try {
            const outcome = await fn();

            if (outcome && outcome.skip) {
                results.push({ name, status: "SKIP", error: outcome.reason });
                return;
            }

            results.push({ name, status: "PASS" });
        } catch (err) {
            results.push({ name, status: "FAIL", error: err.message });
        }
    };

    const authHeaders = () => ({
        Authorization: `Bearer ${state.token}`
    });

    await record("TC-01 invalid login is rejected", async () => {
        const { response } = await request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "admin@flowai.local",
                password: "wrong"
            })
        });
        assert(response.status === 401, `Expected 401, received ${response.status}`);
    });

    await record("TC-02 admin login succeeds", async () => {
        const { response, body } = await request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "admin@flowai.local",
                password: "admin123"
            })
        });
        assert(response.ok, `Expected login success, received ${response.status}`);
        assert(body.token, "Expected token in login response");
        state.token = body.token;
    });

    await record("TC-03 camera list is available", async () => {
        const { response, body } = await request("/api/cameras", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected camera list, received ${response.status}`);
        assert(Array.isArray(body), "Expected camera array");
    });

    await record("TC-04 smoke camera can be created", async () => {
        const { response, body } = await request("/api/cameras", {
            method: "POST",
            headers: {
                ...authHeaders(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: `Smoke Test Camera ${Date.now()}`,
                location: "API smoke test",
                description: "Created by npm run test:api"
            })
        });
        assert(response.status === 201, `Expected camera create success, received ${response.status}`);
        assert(body.id, "Expected camera id");
        state.cameraId = body.id;
    });

    await record("TC-05 zones can be saved and loaded", async () => {
        const zones = {
            camera_source_id: state.cameraId,
            grid_size: 2,
            threshold: 10,
            zones: [
                { name: "Entrance", type: "entry", grid_position: 1, threshold: 8, coordinates: [] },
                { name: "Lobby", type: "monitoring", grid_position: 2, threshold: 12, coordinates: [] },
                { name: "Escalator", type: "transition", grid_position: 3, threshold: 10, coordinates: [] },
                { name: "Exit", type: "exit", grid_position: 4, threshold: 8, coordinates: [] }
            ]
        };

        const save = await request("/api/zones", {
            method: "POST",
            headers: {
                ...authHeaders(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify(zones)
        });
        assert(save.response.ok, `Expected zone save success, received ${save.response.status}`);

        const { response, body } = await request(`/api/zones?camera_source_id=${state.cameraId}`, {
            headers: authHeaders()
        });
        assert(response.ok, `Expected zones, received ${response.status}`);
        assert(Array.isArray(body), "Expected zones array");
        assert(body.length === 4, `Expected 4 zones, received ${body.length}`);
        assert("coordinates" in body[0], "Expected coordinates metadata");
    });

    await record("TC-06 multicamera overview is available", async () => {
        const { response, body } = await request("/api/multicamera/overview", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected multicamera overview, received ${response.status}`);
        assert(Array.isArray(body), "Expected multicamera array");
    });

    await record("TC-07 completed job can be discovered", async () => {
        const { response, body } = await request("/api/analysis-jobs?status=completed", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected job list, received ${response.status}`);
        assert(Array.isArray(body), "Expected job array");

        if (!body.length) {
            return {
                skip: true,
                reason: "No completed job yet. Upload sample_data/mall.mp4 to exercise video/report checks."
            };
        }

        state.completedJobId = body[0].id;
        state.cameraId = body[0].camera_source_id || state.cameraId;
    });

    await record("TC-08 latest stats expose analytics", async () => {
        if (!state.completedJobId) {
            return {
                skip: true,
                reason: "No completed job yet."
            };
        }

        const { response, body } = await request(`/api/stats?job_id=${state.completedJobId}`, {
            headers: authHeaders()
        });
        assert(response.ok, `Expected stats, received ${response.status}`);
        assert("total_people" in body, "Expected total_people");
        assert("density_scores" in body, "Expected density_scores");
    });

    await record("TC-09 job detail exposes analytics", async () => {
        if (!state.completedJobId) {
            return {
                skip: true,
                reason: "No completed job yet."
            };
        }

        const { response, body } = await request(`/api/analysis-jobs/${state.completedJobId}`, {
            headers: authHeaders()
        });
        assert(response.ok, `Expected job detail, received ${response.status}`);
        assert(body.dwell_times, "Expected dwell_times");
        assert(body.density_scores, "Expected density_scores");
    });

    await record("TC-10 CSV report export works", async () => {
        if (!state.completedJobId) {
            return {
                skip: true,
                reason: "No completed job yet."
            };
        }

        const { response, body } = await request("/api/reports/export", {
            method: "POST",
            headers: {
                ...authHeaders(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                jobId: state.completedJobId,
                cameraSourceId: state.cameraId,
                format: "csv"
            })
        });
        assert(response.ok, `Expected CSV report, received ${response.status}`);
        assert(String(body).includes("Density Score"), "Expected density section");
    });

    await record("TC-11 PDF report endpoint works", async () => {
        if (!state.completedJobId) {
            return {
                skip: true,
                reason: "No completed job yet."
            };
        }

        const response = await fetch(`${BASE_URL}/api/reports/pdf?job_id=${state.completedJobId}`, {
            headers: authHeaders()
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        assert(response.ok, `Expected PDF report, received ${response.status}`);
        assert(buffer.subarray(0, 4).toString() === "%PDF", "Expected PDF header");
    });

    for (const result of results) {
        console.log(`${result.status} ${result.name}${result.error ? ` - ${result.error}` : ""}`);
    }

    const failed = results.filter(result => result.status === "FAIL");

    if (failed.length) {
        process.exitCode = 1;
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
