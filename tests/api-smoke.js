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
    const record = async (name, fn) => {
        try {
            await fn();
            results.push({ name, status: "PASS" });
        } catch (err) {
            results.push({ name, status: "FAIL", error: err.message });
        }
    };

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

    let token = "";

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
        token = body.token;
    });

    const authHeaders = () => ({
        Authorization: `Bearer ${token}`
    });

    await record("TC-03 camera list is available", async () => {
        const { response, body } = await request("/api/cameras", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected camera list, received ${response.status}`);
        assert(Array.isArray(body), "Expected camera array");
    });

    await record("TC-04 zones include metadata", async () => {
        const { response, body } = await request("/api/zones?camera_source_id=12", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected zones, received ${response.status}`);
        assert(Array.isArray(body), "Expected zones array");
        assert(body.length === 0 || "coordinates" in body[0], "Expected coordinates metadata");
    });

    await record("TC-05 latest stats are available", async () => {
        const { response, body } = await request("/api/stats?camera_source_id=12", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected stats, received ${response.status}`);
        assert("total_people" in body, "Expected total_people");
    });

    await record("TC-06 job detail exposes analytics", async () => {
        const { response, body } = await request("/api/analysis-jobs/21", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected job detail, received ${response.status}`);
        assert(body.dwell_times, "Expected dwell_times");
        assert(body.density_scores, "Expected density_scores");
    });

    await record("TC-07 multicamera overview is available", async () => {
        const { response, body } = await request("/api/multicamera/overview", {
            headers: authHeaders()
        });
        assert(response.ok, `Expected multicamera overview, received ${response.status}`);
        assert(Array.isArray(body), "Expected multicamera array");
    });

    await record("TC-08 CSV report export works", async () => {
        const { response, body } = await request("/api/reports/export", {
            method: "POST",
            headers: {
                ...authHeaders(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                jobId: 21,
                cameraSourceId: 12,
                format: "csv"
            })
        });
        assert(response.ok, `Expected CSV report, received ${response.status}`);
        assert(String(body).includes("Density Score"), "Expected density section");
    });

    await record("TC-09 PDF report endpoint works", async () => {
        const response = await fetch(`${BASE_URL}/api/reports/pdf?camera_source_id=12&job_id=21`, {
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
