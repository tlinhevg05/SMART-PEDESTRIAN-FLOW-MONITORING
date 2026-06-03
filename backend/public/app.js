let timelineChart = null;
let zoneChart = null;

// =====================================
// LOAD STATS
// =====================================

async function loadStats() {

    try {

        const response =
            await fetch("/api/stats");

        const data =
            await response.json();

        // =====================================
        // UPDATE CARDS
        // =====================================

        document.getElementById(
            "totalPeople"
        ).innerText =
            data.total_people || 0;

        document.getElementById(
            "crowdedZone"
        ).innerText =
            data.most_crowded_zone || "-";

        document.getElementById(
            "popularPath"
        ).innerText =
            data.popular_path || "-";

        const congestionElement =
            document.getElementById(
                "congestionAlert"
            );

        congestionElement.innerText =
            data.congestion_alert || "Normal";

        // =====================================
        // CONGESTION COLOR
        // =====================================

        congestionElement.classList.remove(
            "status-normal",
            "status-warning",
            "status-danger"
        );

        if (
            data.congestion_alert &&
            data.congestion_alert.includes("High")
        ) {

            congestionElement.classList.add(
                "status-danger"
            );

        } else if (
            data.congestion_alert &&
            data.congestion_alert.includes("Moderate")
        ) {

            congestionElement.classList.add(
                "status-warning"
            );

        } else {

            congestionElement.classList.add(
                "status-normal"
            );
        }

        // =====================================
        // ACTIVITY FEED
        // =====================================

        addFeed(
            `${data.total_people} people detected`
        );

        addFeed(
            `Most crowded zone: ${data.most_crowded_zone}`
        );

        addFeed(
            `Popular path: ${data.popular_path}`
        );

        // =====================================
        // UPDATE VIDEO
        // =====================================

        const video =
            document.getElementById(
                "processedVideo"
            );

        video.src =
            "/processed.mp4?t=" +
            new Date().getTime();

        video.load();

        // =====================================
        // UPDATE HEATMAP
        // =====================================

        const heatmap =
            document.getElementById(
                "heatmapImage"
            );

        heatmap.src =
            "/heatmap.png?t=" +
            new Date().getTime();

        // =====================================
        // ZONE CHART
        // =====================================

        renderZoneChart(data);

        // =====================================
        // TIMELINE CHART
        // =====================================

        renderTimelineChart(data);

        const preview =
            document.getElementById(
                "zonePreview"
            );

        if (preview) {

            preview.src =
                "/preview.jpg?t=" +
                Date.now();
        }

    } catch (err) {

        console.log(
            "No stats available"
        );
    }
}

// =====================================
// RENDER ZONE CHART
// =====================================

function renderZoneChart(data) {

    const zoneCounts =
        data.zone_counts || {};

    const labels =
        Object.keys(zoneCounts);

    const values =
        Object.values(zoneCounts);

    const ctx =
        document.getElementById(
            "zoneChart"
        );

    if (!ctx) return;

    if (zoneChart) {

        zoneChart.destroy();
    }

    zoneChart = new Chart(ctx, {

        type: "bar",

        data: {

            labels: labels,

            datasets: [{

                label: "People Count",

                data: values,

                borderRadius: 10
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

// =====================================
// RENDER TIMELINE CHART
// =====================================

function renderTimelineChart(data) {

    const ctx =
        document.getElementById(
            "timelineChart"
        );

    if (!ctx) return;

    if (timelineChart) {

        timelineChart.destroy();
    }

    timelineChart = new Chart(ctx, {

        type: "line",

        data: {

            labels: [

                "Start",
                "25%",
                "50%",
                "75%",
                "End"
            ],

            datasets: [{

                label:
                    "Pedestrian Activity",

                data: [

                    2,
                    8,
                    data.total_people / 2,
                    data.total_people,
                    data.total_people - 2
                ],

                tension: 0.4,

                fill: true
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

// =====================================
// UPLOAD VIDEO
// =====================================

async function uploadVideo() {

    const input =
        document.getElementById(
            "videoInput"
        );

    const file =
        input.files[0];

    if (!file) {

        alert(
            "Please select a video"
        );

        return;
    }

    const uploadButton =
        document.querySelector(
            ".upload-container button"
        );

    uploadButton.innerText =
        "Processing...";

    uploadButton.disabled = true;

    addFeed(
        "Uploading video..."
    );

    const formData =
        new FormData();

    formData.append(
        "video",
        file
    );

    try {

        const response =
            await fetch("/upload", {

                method: "POST",

                body: formData
            });

        const data =
            await response.json();

        console.log(data);

        addFeed(
            "AI tracking started"
        );

        await loadStats();

        addFeed(
            "Heatmap generated"
        );

        addFeed(
            "Analytics completed"
        );

        alert(
            "Processing completed successfully!"
        );

    } catch (err) {

        console.error(err);

        addFeed(
            "Processing failed"
        );

        alert(
            "Processing failed"
        );

    } finally {

        uploadButton.innerText =
            "Upload Video";

        uploadButton.disabled = false;
    }
}

// =====================================
// ACTIVITY FEED
// =====================================

function addFeed(message) {

    const feed =
        document.getElementById(
            "activityFeed"
        );

    if (!feed) return;

    const item =
        document.createElement("div");

    item.className =
        "feed-item";

    const now =
        new Date()
        .toLocaleTimeString();

    item.innerText =
        `[${now}] ${message}`;

    feed.prepend(item);

    // LIMIT FEED

    if (
        feed.children.length > 12
    ) {

        feed.removeChild(
            feed.lastChild
        );
    }
}

// =====================================
// LIVE CLOCK
// =====================================

setInterval(() => {

    const now = new Date();

    const clock =
        document.getElementById(
            "clock"
        );

    if (clock) {

        clock.innerText =
            now.toLocaleTimeString();
    }

}, 1000);

// =====================================
// SWITCH TAB
// =====================================

function switchTab(tabId, button) {

    const pages =
        document.querySelectorAll(
            ".tab-page"
        );

    pages.forEach(page => {

        page.classList.remove(
            "active-page"
        );
    });

    document
        .getElementById(tabId)
        .classList.add(
            "active-page"
        );

    const menuButtons =
        document.querySelectorAll(
            ".menu-item"
        );

    menuButtons.forEach(btn => {

        btn.classList.remove(
            "active"
        );
    });

    button.classList.add(
        "active"
    );
}

// =====================================
// OPEN HEATMAP MODAL
// =====================================

function openHeatmap() {

    const modal =
        document.getElementById(
            "heatmapModal"
        );

    const heatmap =
        document.getElementById(
            "heatmapImage"
        );

    const fullImage =
        document.getElementById(
            "heatmapFull"
        );

    fullImage.src =
        heatmap.src;

    modal.style.display =
        "flex";
}

// =====================================
// CLOSE HEATMAP MODAL
// =====================================

function closeHeatmap() {

    document.getElementById(
        "heatmapModal"
    ).style.display = "none";
}

// =====================================
// CLOSE MODAL WHEN CLICK OUTSIDE
// =====================================

window.onclick = function(event) {

    const modal =
        document.getElementById(
            "heatmapModal"
        );

    if (event.target === modal) {

        modal.style.display = "none";
    }
}

// =====================================
// INITIAL RESET
// =====================================

window.onload = () => {

    // RESET UI

    document.getElementById(
        "totalPeople"
    ).innerText = "0";

    document.getElementById(
        "crowdedZone"
    ).innerText = "-";

    document.getElementById(
        "popularPath"
    ).innerText = "-";

    document.getElementById(
        "congestionAlert"
    ).innerText = "Normal";

    // CLEAR VIDEO

    const video =
        document.getElementById(
            "processedVideo"
        );

    if (video) {

        video.src = "";
    }

    // CLEAR HEATMAP

    const heatmap =
        document.getElementById(
            "heatmapImage"
        );

    if (heatmap) {

        heatmap.src = "";
    }

    // INITIAL FEED

    addFeed(
        "System online"
    );

    addFeed(
        "YOLOv8 initialized"
    );

    addFeed(
        "Monitoring ready"
    );
}
// =====================================
// ZONE SYSTEM
// =====================================

let zones = [];

// =====================================
// GENERATE GRID
// =====================================

function generateGrid() {

    const gridSize =
        parseInt(

            document.getElementById(
                "gridSelector"
            ).value
        );

    const overlay =
        document.getElementById(
            "zoneGridOverlay"
        );

    overlay.innerHTML = "";

    overlay.style.gridTemplateColumns =
        `repeat(${gridSize}, 1fr)`;

    overlay.style.gridTemplateRows =
        `repeat(${gridSize}, 1fr)`;

    zones = [];

    const total =
        gridSize * gridSize;

    for (let i = 0; i < total; i++) {

        const cell =
            document.createElement("div");

        cell.className =
            "grid-cell";

        const zoneName =
            `Zone ${i + 1}`;

        cell.innerHTML = `

            <div class="grid-label">

                ${zoneName}

            </div>
        `;

        cell.onclick = () => {

            renameZone(i);
        };

        overlay.appendChild(cell);

        zones.push({

            id: i,

            name: zoneName,

            grid_position: i
        });
    }

    renderZoneList();
}

// =====================================
// RENAME ZONE
// =====================================

function renameZone(index) {

    const newName =
        prompt(

            "Enter zone name:",
            zones[index].name
        );

    if (!newName) return;

    zones[index].name =
        newName;

    generateGridVisuals();
}

// =====================================
// UPDATE LABELS
// =====================================

function generateGridVisuals() {

    const cells =
        document.querySelectorAll(
            ".grid-cell"
        );

    cells.forEach((cell, index) => {

        cell.innerHTML = `

            <div class="grid-label">

                ${zones[index].name}

            </div>
        `;
    });

    renderZoneList();
}

// =====================================
// RENDER ZONE LIST
// =====================================

function renderZoneList() {

    const container =
        document.getElementById(
            "zoneList"
        );

    container.innerHTML = "";

    zones.forEach(zone => {

        const div =
            document.createElement("div");

        div.className =
            "zone-item";

        div.innerHTML = `

            <strong>
                ${zone.name}
            </strong>
        `;

        container.appendChild(div);
    });
}

// =====================================
// SAVE ZONES
// =====================================

// =====================================
// SAVE ZONES
// =====================================

async function saveZones() {

    const saveButton =
        document.querySelector(
            ".zone-controls button:last-child"
        );

    try {

        saveButton.disabled = true;

        saveButton.innerText =
            "Reprocessing...";

        // =========================
        // SAVE ZONES
        // =========================

        const saveResponse =
            await fetch(
                "/api/zones",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        grid_size:
                            parseInt(
                                document.getElementById(
                                    "gridSelector"
                                ).value
                            ),

                        zones: zones
                    })
                }
            );

        if (!saveResponse.ok) {

            throw new Error(
                "Save zones failed"
            );
        }

        addFeed(
            "Zones saved"
        );

        // =========================
        // REPROCESS VIDEO
        // =========================

        addFeed(
            "Reprocessing video..."
        );

        const reprocessResponse =
            await fetch(
                "/api/reprocess",
                {
                    method: "POST"
                }
            );

        if (!reprocessResponse.ok) {

            throw new Error(
                "Reprocess failed"
            );
        }

        addFeed(
            "Tracking completed"
        );

        // =========================
        // RELOAD DASHBOARD
        // =========================

        await loadStats();

        addFeed(
            "Dashboard updated"
        );

        alert(
            "Zones updated successfully"
        );

    } catch (err) {

        console.error(err);

        alert(
            "Failed to update zones"
        );

    } finally {

        saveButton.disabled = false;

        saveButton.innerText =
            "Save Zones";
    }
}