let timelineChart = null;
let zoneChart = null;
let zones = [];
let currentUser = null;
let latestStatsSignature = "";
let realtimeStatsInterval = null;
let cameraSelectInitialized = false;
let latestJobs = [];
let selectedJobId = "";
let polygonMode = false;
let activeZoneIndex = 0;
let uploadAfterFilePick = false;

function selectedCameraId() {
    return document.getElementById("cameraSelect")?.value || "";
}

function cameraQuery() {
    const cameraId = selectedCameraId();
    const params = new URLSearchParams();

    if (cameraId) params.set("camera_source_id", cameraId);
    if (selectedJobId) params.set("job_id", selectedJobId);

    const query = params.toString();
    return query ? `?${query}` : "";
}

const auth = {
    get token() {
        return localStorage.getItem("flowaiToken");
    },
    set token(value) {
        localStorage.setItem("flowaiToken", value);
    },
    clear() {
        localStorage.removeItem("flowaiToken");
    }
};

async function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {})
    };

    if (auth.token) {
        headers.Authorization = `Bearer ${auth.token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (response.status === 401) {
        showLogin();
    }

    return response;
}

async function login(event) {
    event.preventDefault();

    const error = document.getElementById("loginError");
    error.innerText = "";

    const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email: document.getElementById("loginEmail").value,
            password: document.getElementById("loginPassword").value
        })
    });

    if (!response.ok) {
        error.innerText = "Invalid email or password";
        return;
    }

    const data = await response.json();
    auth.token = data.token;
    currentUser = data.user;
    applyUserState();
    hideLogin();
    await initializeDashboard();
}

async function registerAccount(event) {
    event.preventDefault();

    const message = document.getElementById("registerMessage");
    message.innerText = "";

    const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            fullName: document.getElementById("registerName").value,
            email: document.getElementById("registerEmail").value,
            password: document.getElementById("registerPassword").value
        })
    });

    const data = await response.json();

    if (!response.ok) {
        message.innerText = data.error || "Cannot create account";
        message.className = "form-message error-message";
        return;
    }

    document.getElementById("loginEmail").value = data.email;
    document.getElementById("loginPassword").value = "";
    document.getElementById("registerName").value = "";
    document.getElementById("registerEmail").value = "";
    document.getElementById("registerPassword").value = "";
    message.innerText = "Account created. You can log in now.";
    message.className = "form-message success-message";
}

function logout() {
    auth.clear();
    currentUser = null;
    document.getElementById("loginEmail").value = "";
    document.getElementById("loginPassword").value = "";
    showLogin();
}

function showLogin() {
    document.getElementById("loginScreen").style.display = "flex";
}

function hideLogin() {
    document.getElementById("loginScreen").style.display = "none";
}

function canWrite() {
    return currentUser && currentUser.role === "admin";
}

function isAdmin() {
    return currentUser && currentUser.role === "admin";
}

function applyUserState() {
    document.getElementById("currentUserName").innerText = currentUser.fullName;
    document.getElementById("currentUserRole").innerText = currentUser.role;

    const writeControls = document.querySelectorAll(
        ".upload-container button, .source-form button, .zone-controls button"
    );

    writeControls.forEach(control => {
        control.disabled = !canWrite();
        control.classList.toggle("role-hidden", !canWrite());
    });

    document.querySelectorAll(".admin-only").forEach(element => {
        element.style.display = isAdmin() ? "" : "none";
    });

    const roleMenus = {
        sourcesMenu: ["admin"],
        analyticsMenu: ["admin", "analyst"],
        multicamMenu: ["admin", "analyst", "staff"],
        historyMenu: ["admin", "analyst"],
        alertsMenu: ["admin", "staff"],
        reportsMenu: ["admin", "analyst"],
        systemMenu: ["admin"]
    };

    for (const [menuId, roles] of Object.entries(roleMenus)) {
        const item = document.getElementById(menuId);
        if (item) {
            item.style.display = roles.includes(currentUser.role) ? "" : "none";
        }
    }
}

async function loadSession() {
    if (!auth.token) {
        showLogin();
        return;
    }

    const response = await apiFetch("/api/auth/me");

    if (!response.ok) {
        showLogin();
        return;
    }

    currentUser = await response.json();
    applyUserState();
    hideLogin();
    await initializeDashboard();
}

async function initializeDashboard() {
    addFeed("System online");
    addFeed("YOLOv8 initialized");
    addFeed("Monitoring ready");

    await Promise.all([
        loadCameras(),
        loadStats(),
        loadAlerts(),
        loadJobs(),
        loadFlow(),
        loadReports(),
        loadUsers(),
        loadMulticameraOverview(),
        loadZonesForSelectedCamera()
    ]);

    startRealtimeStats();

    const cameraSelect = document.getElementById("cameraSelect");
    const videoInput = document.getElementById("videoInput");

    if (cameraSelect) {
        cameraSelect.onchange = handleCameraChange;
    }

    if (videoInput) {
        videoInput.onchange = () => {
            if (!uploadAfterFilePick || !videoInput.files.length) return;
            uploadAfterFilePick = false;
            uploadVideo();
        };
        videoInput.oncancel = () => {
            uploadAfterFilePick = false;
        };
    }
}

async function handleCameraChange() {
    latestStatsSignature = "";
    selectedJobId = "";
    await Promise.all([
        loadStats(),
        loadAlerts(),
        loadJobs(),
        loadFlow(),
        loadZonesForSelectedCamera(),
        loadReports(),
        loadMulticameraOverview()
    ]);
}

async function loadMulticameraOverview() {
    const grid = document.getElementById("multicamGrid");

    if (!grid) return;

    const response = await apiFetch("/api/multicamera/overview");

    if (!response.ok) return;

    const cameras = await response.json();
    grid.innerHTML = "";

    if (!cameras.length) {
        grid.innerHTML = `<div class="feed-item">No camera sources registered</div>`;
        return;
    }

    cameras.forEach(camera => {
        const card = document.createElement("div");
        card.className = "multicam-card";
        card.innerHTML = `
            <div class="multicam-media">
                ${camera.preview_path
                    ? `<img src="${camera.preview_path}?t=${Date.now()}" alt="${camera.name} preview">`
                    : `<div class="empty-media">No processed job</div>`}
            </div>
            <div class="multicam-body">
                <div>
                    <strong>${camera.name}</strong>
                    <small>${camera.location || "No location"} · ${camera.status}</small>
                </div>
                <div class="detail-grid compact-detail">
                    <div><strong>People</strong><span>${camera.total_people || 0}</span></div>
                    <div><strong>Peak</strong><span>${camera.most_crowded_zone || "-"}</span></div>
                    <div><strong>Path</strong><span>${camera.popular_path || "-"}</span></div>
                    <div><strong>Alerts</strong><span>${camera.open_alert_count || 0}</span></div>
                </div>
                <button
                    ${camera.analysis_job_id ? "" : "disabled"}
                    onclick="openCameraJob(${camera.camera_source_id}, ${camera.analysis_job_id || "null"})"
                >
                    Open
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

async function openCameraJob(cameraId, jobId) {
    document.getElementById("cameraSelect").value = String(cameraId);
    selectedJobId = jobId ? String(jobId) : "";
    latestStatsSignature = "";
    await handleCameraChange();
    switchTab("dashboardTab", document.querySelector(".menu-item"));
}

async function loadStats() {
    try {
        const response = await apiFetch(`/api/stats${cameraQuery()}`);

        if (!response.ok) {
            clearStatsUi();
            return;
        }

        const data = await response.json();
        const signature = [
            data.id || "",
            data.finished_at || "",
            data.total_people || 0
        ].join(":");

        applyStatsCards(data);

        if (signature !== latestStatsSignature) {
            latestStatsSignature = signature;
            refreshMediaAssets(data);
            renderZoneChart(data);
            renderLineZoneAnalytics(data);
            renderTimelineChart(data);
        }
    } catch (err) {
        clearStatsUi();
        console.log("No stats available");
    }
}

function clearStatsUi() {
    latestStatsSignature = "";
    applyStatsCards({
        total_people: 0,
        most_crowded_zone: "-",
        popular_path: "-",
        congestion_alert: "Normal"
    });

    const video = document.getElementById("processedVideo");
    const source = video?.querySelector("source");
    const fallback = document.getElementById("processedFallback");
    const heatmap = document.getElementById("heatmapImage");
    const zonePreview = document.getElementById("zonePreview");

    if (video) {
        video.pause();
        video.removeAttribute("src");
        video.removeAttribute("poster");
        if (source) source.removeAttribute("src");
        video.load();
    }

    if (fallback) {
        fallback.removeAttribute("src");
        fallback.style.display = "none";
    }

    if (heatmap) {
        heatmap.removeAttribute("src");
        heatmap.style.display = "none";
    }

    if (zonePreview) {
        zonePreview.removeAttribute("src");
        zonePreview.style.display = "none";
    }

    if (zoneChart) {
        zoneChart.destroy();
        zoneChart = null;
    }

    if (timelineChart) {
        timelineChart.destroy();
        timelineChart = null;
    }

    const zoneCanvas = document.getElementById("zoneChart");
    const zoneEmpty = document.getElementById("zoneChartEmpty");
    const lineList = document.getElementById("lineZoneList");

    if (zoneCanvas) zoneCanvas.style.display = "none";
    if (zoneEmpty) zoneEmpty.style.display = "block";
    if (lineList) lineList.innerHTML = `<div class="feed-item">No line zone analytics yet</div>`;
}

function applyStatsCards(data) {
    document.getElementById("totalPeople").innerText = data.total_people || 0;
    const crowdedZone = data.most_crowded_zone === "Unknown"
        ? "-"
        : data.most_crowded_zone || "-";
    const popularPath = (data.popular_path || "").includes("Unknown")
        ? "No mapped zone movement"
        : data.popular_path || "-";
    const congestionAlert = (data.congestion_alert || "Normal").includes("Unknown")
        ? "Normal"
        : data.congestion_alert || "Normal";

    document.getElementById("crowdedZone").innerText = crowdedZone;
    document.getElementById("popularPath").innerText = popularPath;

    const congestionElement = document.getElementById("congestionAlert");
    congestionElement.innerText = congestionAlert;
    congestionElement.classList.remove("status-normal", "status-warning", "status-danger");

    if (congestionAlert.includes("High")) {
        congestionElement.classList.add("status-danger");
    } else if (congestionAlert.includes("Moderate")) {
        congestionElement.classList.add("status-warning");
    } else {
        congestionElement.classList.add("status-normal");
    }
}

function refreshMediaAssets(data = {}) {
    const video = document.getElementById("processedVideo");
    const fallback = document.getElementById("processedFallback");
    const mediaToken = Date.now();
    const previewPath = data.preview_path || "/preview.jpg";
    const processedVideoPath = data.processed_video_path || "/processed.mp4";
    const heatmapPath = data.heatmap_path || "/heatmap.png";

    if (video) {
        if (fallback) {
            fallback.src = `${previewPath}?t=${mediaToken}`;
            fallback.style.display = "none";
        }

        video.poster = `${previewPath}?t=${mediaToken}`;
        video.src = `${processedVideoPath}?t=${mediaToken}`;

        const source = video.querySelector("source");

        if (source) {
            source.src = video.src;
        }

        const showVideo = () => {
            if (fallback) {
                fallback.style.display = "none";
            }

            video.play().catch(() => {
                // Browser autoplay can still be blocked; controls remain visible.
            });
        };

        video.onloadeddata = showVideo;
        video.oncanplay = showVideo;
        video.onerror = () => {
            if (fallback) {
                fallback.style.display = "block";
            }
        };
        video.load();

        window.setTimeout(() => {
            if (fallback && video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
                fallback.style.display = "block";
            }
        }, 1200);
    }

    document.getElementById("heatmapImage").src = `${heatmapPath}?t=${mediaToken}`;
    document.getElementById("heatmapImage").style.display = "block";

    const preview = document.getElementById("zonePreview");

    if (preview) {
        preview.src = `${previewPath}?t=${mediaToken}`;
        preview.style.display = "block";
    }

    renderDashboardZoneOverlay();
}

function startRealtimeStats() {
    if (realtimeStatsInterval) {
        clearInterval(realtimeStatsInterval);
    }

    realtimeStatsInterval = setInterval(loadRealtimeStats, 1000);
}

async function loadRealtimeStats() {
    const video = document.getElementById("processedVideo");

    if (!auth.token || !video || video.paused || !video.currentTime) {
        return;
    }

    const response = await apiFetch(
        `/api/stats/realtime?time=${encodeURIComponent(video.currentTime)}${selectedCameraId() ? `&camera_source_id=${encodeURIComponent(selectedCameraId())}` : ""}`
    );

    if (!response.ok) {
        return;
    }

    const data = await response.json();
    applyStatsCards(data);
}

function renderZoneChart(data) {
    const zoneCounts = data.polygon_zone_counts || data.zone_counts || {};
    const ctx = document.getElementById("zoneChart");
    const empty = document.getElementById("zoneChartEmpty");

    if (!ctx) return;
    if (zoneChart) zoneChart.destroy();

    if (!Object.keys(zoneCounts).length) {
        ctx.style.display = "none";
        if (empty) empty.style.display = "block";
        return;
    }

    ctx.style.display = "block";
    if (empty) empty.style.display = "none";

    zoneChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: Object.keys(zoneCounts),
            datasets: [{
                label: "People Count",
                data: Object.values(zoneCounts),
                borderRadius: 8,
                backgroundColor: "#7132f5"
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: "#686b82"
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#686b82"
                    }
                },
                y: {
                    ticks: {
                        color: "#686b82"
                    }
                }
            }
        }
    });
}

function renderLineZoneAnalytics(data) {
    const list = document.getElementById("lineZoneList");

    if (!list) return;

    const entries = Object.entries(data.line_zone_counts || {});

    if (!entries.length) {
        list.innerHTML = `<div class="feed-item">No line zones configured for this job</div>`;
        return;
    }

    list.innerHTML = entries.map(([zoneName, count]) => `
        <div class="list-row">
            <div>
                <strong>${zoneName}</strong><br>
                <small>Estimated crossings from tracked trajectories</small>
            </div>
            <strong>${count}</strong>
        </div>
    `).join("");
}

function renderTimelineChart(data) {
    const ctx = document.getElementById("timelineChart");

    if (!ctx) return;
    if (timelineChart) timelineChart.destroy();

    const timeline = data.timeline || [];
    const labels = timeline.length ? timeline.map(item => item.label) : ["Start", "25%", "50%", "75%", "End"];
    const values = timeline.length ? timeline.map(item => item.count) : [0, 0, data.total_people || 0, data.total_people || 0, 0];

    timelineChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Pedestrian Activity",
                data: values,
                tension: 0.35,
                fill: true,
                borderColor: "#7132f5",
                backgroundColor: "rgba(113,50,245,0.12)"
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: "#686b82"
                    }
                }
            }
        }
    });
}

async function uploadVideo() {
    if (!canWrite()) return;

    if (!selectedCameraId()) {
        alert("Please create or select a camera source before uploading a video");
        return;
    }

    const input = document.getElementById("videoInput");
    const file = input.files[0];

    if (!file) {
        alert("Please select a video");
        return;
    }

    const uploadButton = document.querySelector(".upload-container button");
    uploadButton.innerText = "Processing...";
    uploadButton.disabled = true;
    addFeed("Uploading video...");

    const formData = new FormData();
    formData.append("video", file);
    formData.append("cameraSourceId", document.getElementById("cameraSelect").value);

    try {
        const response = await apiFetch("/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Processing failed");
        }

        addFeed("Analytics completed");
        latestStatsSignature = "";
        zones = [];
        renderZoneList();
        renderPolygonOverlay();
        renderDashboardZoneOverlay();
        await Promise.all([
            loadStats(),
            loadAlerts(),
            loadJobs(),
            loadFlow(),
            loadZonesForSelectedCamera(),
            loadMulticameraOverview()
        ]);
        alert("Processing completed successfully");
    } catch (err) {
        console.error(err);
        addFeed(err.message);
        alert(err.message);
    } finally {
        uploadButton.innerText = "Upload Video";
        uploadButton.disabled = false;
    }
}

async function loadCameras() {
    const response = await apiFetch("/api/cameras");

    if (!response.ok) return;

    const cameras = await response.json();
    const select = document.getElementById("cameraSelect");
    const previousValue = cameraSelectInitialized ? select.value : "";
    const list = document.getElementById("cameraList");

    select.innerHTML = `<option value="">Select camera</option>`;
    if (list) list.innerHTML = "";

    cameras.forEach(camera => {
        const option = document.createElement("option");
        option.value = camera.id;
        option.innerText = `${camera.name} (${camera.location || "No location"})`;
        select.appendChild(option);

        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `
            <div>
                <strong>${camera.name}</strong><br>
                <small>${camera.location || "No location"} · ${camera.status}</small>
            </div>
            <div class="row-actions">
                <button onclick="editCamera(${camera.id})">Edit</button>
                <button onclick="toggleCameraStatus(${camera.id}, '${camera.status}')">
                    ${camera.status === "active" ? "Disable" : "Activate"}
                </button>
                <button class="danger-button" onclick="deleteCamera(${camera.id})">
                    Delete
                </button>
            </div>
        `;
        if (list) list.appendChild(row);
    });

    if ([...select.options].some(option => option.value === previousValue)) {
        select.value = previousValue;
    }

    cameraSelectInitialized = true;
}

async function createCamera() {
    if (!canWrite()) return;

    const response = await apiFetch("/api/cameras", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: document.getElementById("cameraName").value,
            location: document.getElementById("cameraLocation").value
        })
    });

    if (!response.ok) {
        alert("Cannot create camera source");
        return;
    }

    const camera = await response.json();

    document.getElementById("cameraName").value = "";
    document.getElementById("cameraLocation").value = "";
    await loadCameras();

    if (camera.id) {
        document.getElementById("cameraSelect").value = String(camera.id);
        await handleCameraChange();
    }
}

async function editCamera(cameraId) {
    if (!canWrite()) return;

    const select = document.getElementById("cameraSelect");
    const input = document.getElementById("videoInput");

    if (select) {
        select.value = String(cameraId);
        await handleCameraChange();
    }

    if (input) {
        input.value = "";
        uploadAfterFilePick = true;
        input.click();
    }
}

async function toggleCameraStatus(cameraId, currentStatus) {
    if (!canWrite()) return;

    const response = await apiFetch(`/api/cameras/${cameraId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            status: currentStatus === "active" ? "inactive" : "active"
        })
    });

    if (!response.ok) {
        alert("Cannot update camera status");
        return;
    }

    await loadCameras();
}

async function deleteCamera(cameraId) {
    if (!canWrite()) return;

    if (!confirm("Delete this camera source? Its saved zones will be removed.")) {
        return;
    }

    const response = await apiFetch(`/api/cameras/${cameraId}`, {
        method: "DELETE"
    });

    if (!response.ok) {
        alert("Cannot delete camera source");
        return;
    }

    if (selectedCameraId() === String(cameraId)) {
        document.getElementById("cameraSelect").value = "";
        selectedJobId = "";
    }

    await Promise.all([
        loadCameras(),
        loadStats(),
        loadAlerts(),
        loadJobs(),
        loadFlow(),
        loadZonesForSelectedCamera(),
        loadMulticameraOverview()
    ]);
}

async function seedDemoData() {
    if (!canWrite()) return;

    const response = await apiFetch("/api/demo/seed", {
        method: "POST"
    });
    const data = await response.json();

    if (!response.ok) {
        alert(data.error || "Cannot load demo data");
        return;
    }

    addFeed("Demo analysis data loaded");
    await Promise.all([
        loadCameras(),
        loadStats(),
        loadAlerts(),
        loadJobs(),
        loadFlow()
    ]);
    alert("Demo data loaded successfully");
}

async function loadAlerts() {
    const response = await apiFetch(`/api/alerts${cameraQuery()}`);

    if (!response.ok) return;

    const alerts = await response.json();
    const list = document.getElementById("alertList");
    const managementList = document.getElementById("alertManagementList");
    list.innerHTML = "";

    if (managementList) {
        managementList.innerHTML = "";
    }

    if (!alerts.length) {
        list.innerHTML = `<div class="feed-item">No active alerts</div>`;
        if (managementList) {
            managementList.innerHTML = `<div class="feed-item">No alerts for current filter</div>`;
        }
        return;
    }

    alerts.forEach(alert => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `
            <div>
                <strong>${alert.zone_name}</strong><br>
                <small>${alert.message}</small>
            </div>
            <strong class="status-${alert.severity === "danger" ? "danger" : "warning"}">${alert.actual_count}</strong>
        `;
        list.appendChild(row);

        if (managementList) {
            const managementRow = document.createElement("div");
            managementRow.className = "list-row";
            managementRow.innerHTML = `
                <div>
                    <strong>${alert.zone_name} · ${alert.severity}</strong><br>
                    <small>${alert.message}</small><br>
                    <small>${alert.status || "open"} · ${alert.created_at}</small>
                </div>
                <button
                    class="ack-button ${alert.status === "acknowledged" ? "acknowledged" : ""}"
                    ${alert.status === "acknowledged" ? "disabled" : ""}
                    onclick="acknowledgeAlert(${alert.id})"
                >
                    ${alert.status === "acknowledged" ? "Acknowledged" : "Acknowledge"}
                </button>
            `;
            managementList.appendChild(managementRow);
        }
    });
}

async function loadJobs() {
    const params = new URLSearchParams();
    const cameraId = selectedCameraId();
    const status = document.getElementById("jobStatusFilter")?.value || "";
    const search = document.getElementById("jobSearch")?.value || "";

    if (cameraId) params.set("camera_source_id", cameraId);
    if (status) params.set("status", status);
    if (search) params.set("search", search);

    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await apiFetch(`/api/analysis-jobs${query}`);

    if (!response.ok) return;

    const jobs = await response.json();
    latestJobs = jobs;
    const list = document.getElementById("jobList");
    const historyList = document.getElementById("jobHistoryList");
    if (list) list.innerHTML = "";

    if (historyList) {
        historyList.innerHTML = "";
    }

    if (!jobs.length) {
        if (list) list.innerHTML = `<div class="feed-item">No analysis jobs yet</div>`;
        if (historyList) {
            historyList.innerHTML = `<div class="feed-item">No analysis jobs match current filter</div>`;
        }
        return;
    }

    jobs.forEach(job => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `
            <div>
                <strong>#${job.id} · ${job.status}</strong><br>
                <small>${job.total_people || 0} people · ${job.congestion_alert || "Normal"}</small>
            </div>
            <small>${job.finished_at || job.created_at}</small>
        `;
        if (list) list.appendChild(row);

        if (historyList) {
            const historyRow = document.createElement("div");
            historyRow.className = "list-row clickable-row";
            historyRow.onclick = () => selectAnalysisJob(job.id);
            historyRow.innerHTML = `
                <div>
                    <strong>#${job.id} · ${job.status}</strong><br>
                    <small>${job.camera_name || "Unknown camera"} · ${job.video_name || "Uploaded video"}</small><br>
                    <small>${job.total_people || 0} people · ${job.most_crowded_zone || "-"}</small>
                </div>
                <small>${job.finished_at || job.created_at}</small>
            `;
            historyList.appendChild(historyRow);
        }
    });

    if (jobs[0]?.id && document.getElementById("jobDetail")) {
        await loadJobDetail(jobs[0].id);
    }
}

async function selectAnalysisJob(jobId) {
    selectedJobId = String(jobId);
    latestStatsSignature = "";
    await Promise.all([
        loadJobDetail(jobId),
        loadStats(),
        loadFlow(),
        loadAlerts()
    ]);
    addFeed(`Viewing analysis job #${jobId}`);
}

async function clearSelectedJob() {
    selectedJobId = "";
    latestStatsSignature = "";
    await Promise.all([
        loadStats(),
        loadFlow(),
        loadAlerts()
    ]);
    addFeed("Viewing latest completed job");
}

async function loadFlow() {
    const response = await apiFetch(`/api/flow${cameraQuery()}`);

    if (!response.ok) return;

    const flows = await response.json();
    const list = document.getElementById("flowList");

    if (!list) return;

    list.innerHTML = "";

    if (!flows.length) {
        list.innerHTML = `<div class="feed-item">No transition flow data</div>`;
        return;
    }

    flows.forEach(flow => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `
            <div>
                <strong>${flow.from_zone} → ${flow.to_zone}</strong><br>
                <small>Zone-to-zone movement</small>
            </div>
            <strong>${flow.transition_count}</strong>
        `;
        list.appendChild(row);
    });
}

async function acknowledgeAlert(alertId) {
    const response = await apiFetch(`/api/alerts/${alertId}/acknowledge`, {
        method: "PATCH"
    });

    if (!response.ok) {
        alert("Cannot acknowledge alert");
        return;
    }

    await loadAlerts();
}

async function loadJobDetail(jobId) {
    const detail = document.getElementById("jobDetail");

    if (!detail) return;

    const response = await apiFetch(`/api/analysis-jobs/${jobId}`);

    if (!response.ok) {
        detail.innerHTML = `<div class="feed-item">Cannot load job detail</div>`;
        return;
    }

    const job = await response.json();
    const zoneRows = job.zone_count_rows || [];
    const flowRows = job.flow_rows || [];
    const dwellTimes = job.dwell_times || {};
    const densityScores = job.density_scores || {};

    detail.innerHTML = `
        <div class="action-row">
            <button onclick="selectAnalysisJob(${job.id})">View On Dashboard</button>
            <button class="secondary-button" onclick="clearSelectedJob()">Latest Job</button>
        </div>
        <div class="detail-grid">
            <div><strong>Job</strong><span>#${job.id} · ${job.status}</span></div>
            <div><strong>Camera</strong><span>${job.camera_name || "-"}</span></div>
            <div><strong>Video</strong><span>${job.video_name || "-"}</span></div>
            <div><strong>Total people</strong><span>${job.total_people || 0}</span></div>
            <div><strong>Peak zone</strong><span>${job.most_crowded_zone || "-"}</span></div>
            <div><strong>Popular path</strong><span>${job.popular_path || "-"}</span></div>
        </div>
        <h3>Zone Analytics</h3>
        ${zoneRows.map(row => `
            <div class="list-row">
                <div>
                    <strong>${row.zone_name}</strong><br>
                    <small>Dwell ${dwellTimes[row.zone_name] || 0}s · Density ${densityScores[row.zone_name] || 0}</small>
                </div>
                <strong>${row.people_count}</strong>
            </div>
        `).join("")}
        <h3>Transition Matrix</h3>
        ${flowRows.slice(0, 8).map(row => `
            <div class="list-row">
                <div><strong>${row.from_zone} → ${row.to_zone}</strong></div>
                <strong>${row.transition_count}</strong>
            </div>
        `).join("")}
    `;
}

async function exportReport() {
    const body = {
        cameraSourceId: selectedCameraId() || null,
        jobId: document.getElementById("reportJobId")?.value || null,
        format: "csv"
    };

    const response = await apiFetch("/api/reports/export", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        alert("No completed analysis job is available");
        return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flowai-report.csv";
    link.click();
    URL.revokeObjectURL(url);
    await loadReports();
}

async function downloadPdfReport() {
    const params = new URLSearchParams();
    const cameraId = selectedCameraId();
    const jobId = document.getElementById("reportJobId")?.value || selectedJobId;

    if (cameraId) params.set("camera_source_id", cameraId);
    if (jobId) params.set("job_id", jobId);

    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await apiFetch(`/api/reports/pdf${query}`);

    if (!response.ok) {
        alert("No completed analysis job is available");
        return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flowai-report.pdf";
    link.click();
    URL.revokeObjectURL(url);
}

async function loadReports() {
    const list = document.getElementById("reportHistoryList");

    if (!list) return;

    const response = await apiFetch("/api/reports");

    if (!response.ok) return;

    const reports = await response.json();
    list.innerHTML = "";

    if (!reports.length) {
        list.innerHTML = `<div class="feed-item">No reports exported yet</div>`;
        return;
    }

    reports.forEach(report => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `
            <div>
                <strong>Report #${report.id} · Job #${report.analysis_job_id}</strong><br>
                <small>${report.camera_name || "All cameras"} · ${report.generated_by_name || "Unknown user"}</small>
            </div>
            <small>${report.created_at}</small>
        `;
        list.appendChild(row);
    });
}

async function loadUsers() {
    const list = document.getElementById("userList");

    if (!list || !isAdmin()) return;

    const response = await apiFetch("/api/users");

    if (!response.ok) return;

    const users = await response.json();
    list.innerHTML = "";

    users.forEach(user => {
        const row = document.createElement("div");
        row.className = "list-row user-row";
        row.innerHTML = `
            <div>
                <strong>${user.full_name}</strong><br>
                <small>${user.email}</small>
            </div>
            <select onchange="updateUser(${user.id}, { role: this.value })">
                <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
                <option value="analyst" ${user.role === "analyst" ? "selected" : ""}>Analyst</option>
                <option value="staff" ${user.role === "staff" ? "selected" : ""}>Staff</option>
            </select>
            <button onclick="toggleUserStatus(${user.id}, '${user.status}')">
                ${user.status === "active" ? "Deactivate" : "Activate"}
            </button>
        `;
        list.appendChild(row);
    });
}

async function updateUser(userId, patch) {
    const response = await apiFetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
    });

    if (!response.ok) {
        alert("Cannot update user");
        await loadUsers();
    }
}

async function toggleUserStatus(userId, currentStatus) {
    await updateUser(userId, {
        status: currentStatus === "active" ? "inactive" : "active"
    });
    await loadUsers();
}

function addFeed(message) {
    const feed = document.getElementById("activityFeed");

    if (!feed) return;

    const item = document.createElement("div");
    item.className = "feed-item";
    item.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    feed.prepend(item);

    if (feed.children.length > 12) {
        feed.removeChild(feed.lastChild);
    }
}

setInterval(() => {
    const clock = document.getElementById("clock");

    if (clock) {
        clock.innerText = new Date().toLocaleTimeString();
    }
}, 1000);

setInterval(() => {
    if (auth.token) {
        loadStats();
        loadAlerts();
        loadJobs();
        loadFlow();
        loadReports();
    }
}, 10000);

function switchTab(tabId, button) {
    document.querySelectorAll(".tab-page").forEach(page => {
        page.classList.remove("active-page");
    });
    document.getElementById(tabId).classList.add("active-page");
    document.querySelectorAll(".menu-item").forEach(btn => {
        btn.classList.remove("active");
    });
    button.classList.add("active");
}

function openHeatmap() {
    const modal = document.getElementById("heatmapModal");
    const heatmap = document.getElementById("heatmapImage");
    const fullImage = document.getElementById("heatmapFull");

    fullImage.src = heatmap.src;
    modal.style.display = "flex";
}

function closeHeatmap() {
    document.getElementById("heatmapModal").style.display = "none";
}

function makeGeometry(shape, points = []) {
    return {
        shape,
        points
    };
}

function normalizeGeometry(rawCoordinates, fallbackPoints = []) {
    if (Array.isArray(rawCoordinates)) {
        return makeGeometry(
            rawCoordinates.length === 2 ? "line" : "polygon",
            rawCoordinates
        );
    }

    if (rawCoordinates && Array.isArray(rawCoordinates.points)) {
        return makeGeometry(
            rawCoordinates.shape === "line" ? "line" : "polygon",
            rawCoordinates.points
        );
    }

    return makeGeometry("polygon", fallbackPoints);
}

function getZoneGeometry(zone) {
    return normalizeGeometry(zone.coordinates);
}

function setZoneGeometry(zone, shape, points) {
    zone.coordinates = makeGeometry(shape, points);
}

function getZonePoints(zone) {
    return getZoneGeometry(zone).points || [];
}

window.onclick = event => {
    const modal = document.getElementById("heatmapModal");

    if (event.target === modal) {
        modal.style.display = "none";
    }
};

function renderGridFromZones(gridSize, savedZones) {
    zones = savedZones.map((savedZone, index) => {
        const zoneName = savedZone?.name || savedZone?.zone_name || `Zone ${index + 1}`;
        const threshold = Number(savedZone?.threshold || 10);
        const type = savedZone?.type || savedZone?.zone_type || "monitoring";
        const fallbackPoints = [];
        const coordinates = normalizeGeometry(savedZone?.coordinates, fallbackPoints);

        return {
            id: index,
            name: zoneName,
            type,
            grid_position: index,
            coordinates,
            threshold
        };
    });

    activeZoneIndex = zones.length ? Math.min(activeZoneIndex, zones.length - 1) : 0;

    renderZoneList();
    setupPolygonCanvas();
    renderPolygonOverlay();
    renderDashboardZoneOverlay();
}

function setupPolygonCanvas() {
    const wrapper = document.querySelector(".zone-preview-wrapper");
    const svg = document.getElementById("polygonOverlay");

    if (!wrapper || !svg || svg.dataset.ready) return;

    svg.dataset.ready = "true";
    svg.addEventListener("click", event => {
        if (!polygonMode || !zones[activeZoneIndex]) return;

        const rect = svg.getBoundingClientRect();
        const mode = document.getElementById("zoneDrawMode")?.value || "polygon";
        const point = {
            x: Number(((event.clientX - rect.left) / rect.width).toFixed(4)),
            y: Number(((event.clientY - rect.top) / rect.height).toFixed(4))
        };

        const current = getZoneGeometry(zones[activeZoneIndex]);
        const basePoints = current.shape === mode ? current.points : [];
        const nextPoints = mode === "line"
            ? [...basePoints, point].slice(-2)
            : [...basePoints, point];

        setZoneGeometry(zones[activeZoneIndex], mode, nextPoints);
        renderZoneList();
        renderPolygonOverlay();
        renderDashboardZoneOverlay();
    });
}

function togglePolygonMode() {
    if (!zones[activeZoneIndex]) {
        alert("Please add and select a zone first");
        return;
    }

    polygonMode = true;
    const wrapper = document.querySelector(".zone-preview-wrapper");

    if (wrapper) {
        wrapper.classList.add("polygon-active");
    }

    addFeed(`Drawing enabled for ${zones[activeZoneIndex].name}`);
}

function clearActivePolygon() {
    if (!zones[activeZoneIndex]) return;

    const mode = document.getElementById("zoneDrawMode")?.value || getZoneGeometry(zones[activeZoneIndex]).shape;
    setZoneGeometry(zones[activeZoneIndex], mode, []);
    renderZoneList();
    renderPolygonOverlay();
    renderDashboardZoneOverlay();
}

function selectZoneForPolygon(index) {
    activeZoneIndex = index;
    polygonMode = false;
    document.querySelector(".zone-preview-wrapper")?.classList.remove("polygon-active");
    const modeSelect = document.getElementById("zoneDrawMode");
    if (modeSelect && zones[index]) {
        modeSelect.value = getZoneGeometry(zones[index]).shape;
    }
    renderZoneList();
    renderPolygonOverlay();
    addFeed(`Selected ${zones[index].name}`);
}

function renderPolygonOverlay() {
    const svg = document.getElementById("polygonOverlay");

    if (!svg) return;

    renderZoneSvg(svg, true);
}

function renderDashboardZoneOverlay() {
    const svg = document.getElementById("dashboardZoneOverlay");

    if (!svg) return;

    renderZoneSvg(svg, false);
}

function renderZoneSvg(svg, editable) {
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");

    zones.forEach((zone, index) => {
        const geometry = getZoneGeometry(zone);
        const points = geometry.points || [];

        if (!points.length) return;

        if (geometry.shape === "line" && points.length >= 2) {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", points[0].x * 100);
            line.setAttribute("y1", points[0].y * 100);
            line.setAttribute("x2", points[1].x * 100);
            line.setAttribute("y2", points[1].y * 100);
            line.setAttribute("class", index === activeZoneIndex ? "active-zone-line" : "zone-line");
            svg.appendChild(line);
        } else if (geometry.shape !== "line" && points.length >= 3) {
            const pointText = points
                .map(point => `${point.x * 100},${point.y * 100}`)
                .join(" ");

            const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            polygon.setAttribute("points", pointText);
            polygon.setAttribute("class", index === activeZoneIndex ? "active-polygon" : "zone-polygon");
            svg.appendChild(polygon);
        }

        if (points.length) {
            const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", points[0].x * 100 + 1);
            label.setAttribute("y", points[0].y * 100 + 4);
            label.setAttribute("class", "zone-svg-label");
            label.textContent = zone.name;
            svg.appendChild(label);
        }

        if (!editable) return;

        points.forEach(point => {
            const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot.setAttribute("cx", point.x * 100);
            dot.setAttribute("cy", point.y * 100);
            dot.setAttribute("r", "1.4");
            dot.setAttribute("class", "polygon-dot");
            svg.appendChild(dot);
        });
    });
}

function gridCellCoordinates(index, gridSize) {
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;
    const x1 = Number((col / gridSize).toFixed(4));
    const y1 = Number((row / gridSize).toFixed(4));
    const x2 = Number(((col + 1) / gridSize).toFixed(4));
    const y2 = Number(((row + 1) / gridSize).toFixed(4));

    return [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 }
    ];
}

async function loadZonesForSelectedCamera() {
    const cameraId = selectedCameraId();

    if (!cameraId) {
        zones = [];
        document.getElementById("zoneList").innerHTML = "";
        document.getElementById("zonePreview")?.removeAttribute("src");
        renderDashboardZoneOverlay();
        return;
    }

    const response = await apiFetch(
        `/api/zones?camera_source_id=${encodeURIComponent(cameraId)}`
    );

    if (!response.ok) return;

    const savedZones = await response.json();

    if (!Array.isArray(savedZones) || !savedZones.length) {
        zones = [];
        document.getElementById("zoneList").innerHTML =
            `<div class="feed-item">No zones configured for this camera</div>`;
        renderThresholdSummary();
        renderDashboardZoneOverlay();
        return;
    }

    renderGridFromZones(Number(savedZones[0].grid_size || 2), savedZones);
    renderThresholdSummary();
}

function renameZone(index) {
    const newName = prompt("Enter zone name:", zones[index].name);

    if (!newName) return;

    const threshold = Number(prompt("Density threshold:", zones[index].threshold || 10)) || 10;
    const type = prompt("Zone type:", zones[index].type || "monitoring") || "monitoring";
    zones[index].name = newName;
    zones[index].type = type;
    zones[index].threshold = threshold;
    renderZoneList();
    renderPolygonOverlay();
    renderDashboardZoneOverlay();
}

function generateGridVisuals() {
    renderZoneList();
}

function addZone() {
    if (!canWrite()) return;

    const shape = document.getElementById("zoneDrawMode")?.value || "polygon";
    const name = prompt("Zone name:", `Zone ${zones.length + 1}`);

    if (!name) return;

    const type = prompt("Zone type:", shape === "line" ? "counting-line" : "monitoring") || (shape === "line" ? "counting-line" : "monitoring");
    const threshold = Number(prompt("Density threshold:", "10")) || 10;
    const index = zones.length;

    zones.push({
        id: index,
        name,
        type,
        grid_position: index,
        coordinates: makeGeometry(shape, []),
        threshold
    });

    activeZoneIndex = index;
    polygonMode = false;
    document.querySelector(".zone-preview-wrapper")?.classList.remove("polygon-active");
    renderZoneList();
    renderPolygonOverlay();
    renderDashboardZoneOverlay();
}

function renderZoneList() {
    const container = document.getElementById("zoneList");
    container.innerHTML = "";

    zones.forEach((zone, index) => {
        const geometry = getZoneGeometry(zone);
        const points = geometry.points || [];
        const thresholdOptions = [5, 10, 12, 15, 20, 25, 30, 40, 50];
        const threshold = Number(zone.threshold || 10);
        const options = thresholdOptions.includes(threshold)
            ? thresholdOptions
            : [threshold, ...thresholdOptions].sort((a, b) => a - b);
        const div = document.createElement("div");
        div.className = "zone-item";
        div.innerHTML = `
            <strong>${zone.name}</strong>
            <div class="zone-meta-row">
                <span>${zone.type || "monitoring"} · ${geometry.shape} · Points: ${points.length}</span>
                <label>
                    Threshold
                    <select onchange="updateZoneThreshold(${index}, this.value)">
                        ${options.map(value => `
                            <option value="${value}" ${value === threshold ? "selected" : ""}>${value}</option>
                        `).join("")}
                    </select>
                </label>
            </div>
            <div class="row-actions">
                <button onclick="selectZoneForPolygon(${index})">Draw</button>
                <button class="danger-button" onclick="deleteZone(${index})">Delete</button>
            </div>
        `;
        container.appendChild(div);
    });

    renderThresholdSummary();
}

function updateZoneThreshold(index, value) {
    if (!canWrite() || !zones[index]) return;

    zones[index].threshold = Number(value) || 10;
    renderThresholdSummary();
}

function deleteZone(index) {
    if (!canWrite()) return;

    if (!zones[index]) return;

    if (!confirm(`Delete zone "${zones[index].name}"?`)) {
        return;
    }

    zones.splice(index, 1);
    zones = zones.map((zone, nextIndex) => ({
        ...zone,
        id: nextIndex,
        grid_position: nextIndex
    }));
    activeZoneIndex = zones.length ? Math.min(activeZoneIndex, zones.length - 1) : 0;
    renderZoneList();
    renderPolygonOverlay();
    renderDashboardZoneOverlay();
}

function renderThresholdSummary() {
    const container = document.getElementById("thresholdSummary");

    if (!container) return;

    if (!zones.length) {
        container.innerHTML = `<div class="feed-item">Select a camera to view configured thresholds</div>`;
        return;
    }

    container.innerHTML = zones.map(zone => `
        <div class="list-row">
            <div><strong>${zone.name}</strong></div>
            <strong>${zone.threshold}</strong>
        </div>
    `).join("");
}

async function saveZones() {
    if (!canWrite()) return;

    if (!selectedCameraId()) {
        alert("Please create or select a camera source before saving zones");
        return;
    }

    const saveButton = document.querySelector(".zone-controls button:last-child");

    try {
        saveButton.disabled = true;
        saveButton.innerText = "Saving...";

        const response = await apiFetch("/api/zones", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                camera_source_id: document.getElementById("cameraSelect").value || null,
                grid_size: 1,
                zones: zones.map((zone, index) => ({
                    ...zone,
                    grid_position: index
                }))
            })
        });

        if (!response.ok) {
            throw new Error("Save zones failed");
        }

        addFeed("Zones saved");

        const reprocessResponse = await apiFetch("/api/reprocess", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                cameraSourceId: selectedCameraId()
            })
        });

        if (reprocessResponse.ok) {
            addFeed("Dashboard updated");
            latestStatsSignature = "";
            await Promise.all([loadStats(), loadAlerts(), loadJobs(), loadFlow(), loadMulticameraOverview()]);
        } else {
            const data = await reprocessResponse.json();
            addFeed(data.error || "Zones saved; upload a video to process this camera");
        }

        alert("Zones updated successfully");
    } catch (err) {
        console.error(err);
        alert(err.message);
    } finally {
        saveButton.disabled = false;
        saveButton.innerText = "Save Zones";
    }
}

window.onload = loadSession;
