const express = require("express");
const { pool } = require("../config/db");
const { authenticate, authorize } = require("../services/authService");

const router = express.Router();

function csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
}

async function getReportJob({ jobId, cameraSourceId }) {
    const params = [];
    const filters = ["status = 'completed'"];

    if (jobId) {
        params.push(jobId);
        filters.push(`id = $${params.length}`);
    }

    if (cameraSourceId) {
        params.push(cameraSourceId);
        filters.push(`camera_source_id = $${params.length}`);
    }

    const result = await pool.query(
        `
        SELECT id, total_people, most_crowded_zone, popular_path,
               zone_counts, transitions, timeline, dwell_times, density_scores,
               congestion_alert, camera_source_id, finished_at
        FROM analysis_jobs
        WHERE ${filters.join(" AND ")}
        ORDER BY finished_at DESC NULLS LAST, id DESC
        LIMIT 1
        `,
        params
    );

    return result.rows[0];
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function pdfEscape(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/[^\x20-\x7E]/g, "?");
}

function buildSimplePdf(lines) {
    const objects = [];
    const addObject = content => {
        objects.push(content);
        return objects.length;
    };
    const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesId = addObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    const pageId = addObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
    const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const text = [
        "BT",
        "/F1 11 Tf",
        "50 750 Td",
        ...lines.flatMap((line, index) => [
            index === 0 ? "" : "0 -16 Td",
            `(${pdfEscape(line).slice(0, 95)}) Tj`
        ]).filter(Boolean),
        "ET"
    ].join("\n");
    addObject(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);

    let pdf = "%PDF-1.4\n";
    const offsets = [0];

    objects.forEach((content, index) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${index + 1} 0 obj\n${content}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    offsets.slice(1).forEach(offset => {
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

router.post("/reports/export", authenticate, authorize("admin", "analyst"), async (req, res) => {
    const { jobId, cameraSourceId, format } = req.body || {};
    const job = await getReportJob({ jobId, cameraSourceId });

    if (!job) {
        return res.status(404).json({
            error: "No completed analysis job is available"
        });
    }

    await pool.query(
        `
        INSERT INTO reports (analysis_job_id, camera_source_id, generated_by, format, filters)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
            job.id,
            job.camera_source_id,
            req.user.id,
            format || "csv",
            JSON.stringify({
                jobId: jobId || null,
                cameraSourceId: cameraSourceId || null
            })
        ]
    );

    const lines = [
        ["Metric", "Value"].map(csvEscape).join(","),
        ["Analysis Job", job.id].map(csvEscape).join(","),
        ["Total People", job.total_people].map(csvEscape).join(","),
        ["Most Crowded Zone", job.most_crowded_zone].map(csvEscape).join(","),
        ["Popular Path", job.popular_path].map(csvEscape).join(","),
        ["Congestion Alert", job.congestion_alert].map(csvEscape).join(","),
        ["Finished At", job.finished_at].map(csvEscape).join(","),
        [],
        ["Zone", "Count"].map(csvEscape).join(",")
    ];

    for (const [zone, count] of Object.entries(job.zone_counts || {})) {
        lines.push([zone, count].map(csvEscape).join(","));
    }

    lines.push([]);
    lines.push(["Transition", "Count"].map(csvEscape).join(","));

    for (const [transition, count] of Object.entries(job.transitions || {})) {
        lines.push([transition, count].map(csvEscape).join(","));
    }

    lines.push([]);
    lines.push(["Zone", "Dwell Time Seconds"].map(csvEscape).join(","));

    for (const [zone, seconds] of Object.entries(job.dwell_times || {})) {
        lines.push([zone, seconds].map(csvEscape).join(","));
    }

    lines.push([]);
    lines.push(["Zone", "Density Score"].map(csvEscape).join(","));

    for (const [zone, score] of Object.entries(job.density_scores || {})) {
        lines.push([zone, score].map(csvEscape).join(","));
    }

    lines.push([]);
    lines.push(["Timeline Window", "Unique People"].map(csvEscape).join(","));

    for (const item of job.timeline || []) {
        lines.push([item.label, item.count].map(csvEscape).join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=flowai-report.csv");
    res.send(lines.join("\n"));
});

router.get("/reports/print", authenticate, authorize("admin", "analyst"), async (req, res) => {
    const job = await getReportJob({
        jobId: req.query.job_id,
        cameraSourceId: req.query.camera_source_id
    });

    if (!job) {
        return res.status(404).send("No completed analysis job is available");
    }

    const zoneRows = Object.entries(job.zone_counts || {})
        .map(([zone, count]) => `
            <tr>
                <td>${escapeHtml(zone)}</td>
                <td>${escapeHtml(count)}</td>
                <td>${escapeHtml((job.dwell_times || {})[zone] || 0)}</td>
                <td>${escapeHtml((job.density_scores || {})[zone] || 0)}</td>
            </tr>
        `).join("");

    const transitionRows = Object.entries(job.transitions || {})
        .map(([transition, count]) => `
            <tr>
                <td>${escapeHtml(transition)}</td>
                <td>${escapeHtml(count)}</td>
            </tr>
        `).join("");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
        <!doctype html>
        <html>
        <head>
            <title>FlowAI Report #${escapeHtml(job.id)}</title>
            <style>
                body { font-family: Arial, sans-serif; color: #101114; margin: 32px; }
                h1 { color: #7132f5; margin-bottom: 4px; }
                .meta { color: #686b82; margin-bottom: 24px; }
                .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
                .card { border: 1px solid #dedee5; border-radius: 8px; padding: 14px; }
                .card strong { display: block; color: #686b82; font-size: 12px; text-transform: uppercase; }
                .card span { font-size: 22px; font-weight: 700; }
                table { width: 100%; border-collapse: collapse; margin: 16px 0 28px; }
                th, td { border: 1px solid #dedee5; padding: 10px; text-align: left; }
                th { background: #f4f7fb; }
                @media print { button { display: none; } body { margin: 18mm; } }
            </style>
        </head>
        <body>
            <button onclick="window.print()">Print / Save PDF</button>
            <h1>Smart Pedestrian Flow Analytics Report</h1>
            <div class="meta">Analysis job #${escapeHtml(job.id)} · Finished ${escapeHtml(job.finished_at)}</div>
            <div class="grid">
                <div class="card"><strong>Total People</strong><span>${escapeHtml(job.total_people)}</span></div>
                <div class="card"><strong>Peak Zone</strong><span>${escapeHtml(job.most_crowded_zone)}</span></div>
                <div class="card"><strong>Popular Path</strong><span>${escapeHtml(job.popular_path)}</span></div>
                <div class="card"><strong>Status</strong><span>${escapeHtml(job.congestion_alert)}</span></div>
            </div>
            <h2>Zone Count, Dwell Time, and Density</h2>
            <table>
                <thead><tr><th>Zone</th><th>Count</th><th>Dwell Time (s)</th><th>Density Score</th></tr></thead>
                <tbody>${zoneRows}</tbody>
            </table>
            <h2>Transition Flow</h2>
            <table>
                <thead><tr><th>Transition</th><th>Count</th></tr></thead>
                <tbody>${transitionRows}</tbody>
            </table>
        </body>
        </html>
    `);
});

router.get("/reports/pdf", authenticate, authorize("admin", "analyst"), async (req, res) => {
    const job = await getReportJob({
        jobId: req.query.job_id,
        cameraSourceId: req.query.camera_source_id
    });

    if (!job) {
        return res.status(404).send("No completed analysis job is available");
    }

    const lines = [
        "Smart Pedestrian Flow Analytics Report",
        `Analysis job #${job.id}`,
        `Finished: ${job.finished_at}`,
        `Total people: ${job.total_people}`,
        `Peak zone: ${job.most_crowded_zone}`,
        `Popular path: ${job.popular_path}`,
        `Status: ${job.congestion_alert}`,
        "",
        "Zone count, dwell time, density:"
    ];

    for (const [zone, count] of Object.entries(job.zone_counts || {})) {
        lines.push(`${zone}: count ${count}, dwell ${(job.dwell_times || {})[zone] || 0}s, density ${(job.density_scores || {})[zone] || 0}`);
    }

    lines.push("");
    lines.push("Transition flow:");

    for (const [transition, count] of Object.entries(job.transitions || {})) {
        lines.push(`${transition}: ${count}`);
    }

    const pdf = buildSimplePdf(lines.slice(0, 42));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=flowai-report-${job.id}.pdf`);
    res.send(pdf);
});

router.get("/reports", authenticate, authorize("admin", "analyst"), async (req, res) => {
    const result = await pool.query(
        `
        SELECT r.id, r.analysis_job_id, r.camera_source_id, r.format,
               r.filters, r.created_at, u.full_name AS generated_by_name,
               cs.name AS camera_name
        FROM reports r
        LEFT JOIN users u ON u.id = r.generated_by
        LEFT JOIN camera_sources cs ON cs.id = r.camera_source_id
        ORDER BY r.created_at DESC
        LIMIT 30
        `
    );

    res.json(result.rows);
});

module.exports = router;
