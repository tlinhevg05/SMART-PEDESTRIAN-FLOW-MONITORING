CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(160) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'analyst', 'staff')),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS camera_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    location VARCHAR(160),
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE camera_sources
DROP COLUMN IF EXISTS stream_url;

CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    path TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'uploaded',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zones (
    id SERIAL PRIMARY KEY,
    camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE CASCADE,
    zone_name VARCHAR(120) NOT NULL,
    zone_type VARCHAR(60) DEFAULT 'monitoring',
    grid_position INTEGER NOT NULL,
    grid_size INTEGER NOT NULL,
    coordinates JSONB DEFAULT '[]'::jsonb,
    threshold INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
    id SERIAL PRIMARY KEY,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'queued',
    total_people INTEGER DEFAULT 0,
    most_crowded_zone VARCHAR(120),
    popular_path VARCHAR(240),
    zone_counts JSONB DEFAULT '{}'::jsonb,
    transitions JSONB DEFAULT '{}'::jsonb,
    timeline JSONB DEFAULT '[]'::jsonb,
    dwell_times JSONB DEFAULT '{}'::jsonb,
    density_scores JSONB DEFAULT '{}'::jsonb,
    congestion_alert TEXT DEFAULT 'Normal',
    processed_video_path TEXT,
    heatmap_path TEXT,
    preview_path TEXT,
    error_message TEXT,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pedestrian_tracks (
    id SERIAL PRIMARY KEY,
    analysis_job_id INTEGER REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    anonymous_track_id INTEGER NOT NULL,
    start_frame INTEGER,
    end_frame INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trajectory_points (
    id SERIAL PRIMARY KEY,
    pedestrian_track_id INTEGER REFERENCES pedestrian_tracks(id) ON DELETE CASCADE,
    frame_index INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    zone_name VARCHAR(120),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_records (
    id SERIAL PRIMARY KEY,
    analysis_job_id INTEGER REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    from_zone VARCHAR(120) NOT NULL,
    to_zone VARCHAR(120) NOT NULL,
    transition_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zone_counts (
    id SERIAL PRIMARY KEY,
    analysis_job_id INTEGER REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    zone_name VARCHAR(120) NOT NULL,
    people_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    analysis_job_id INTEGER REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    zone_name VARCHAR(120) NOT NULL,
    threshold INTEGER NOT NULL,
    actual_count INTEGER NOT NULL,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE analysis_jobs
ADD COLUMN IF NOT EXISTS timeline JSONB DEFAULT '[]'::jsonb;

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users
SET role = 'staff'
WHERE role = 'operator';

ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('admin', 'analyst', 'staff'));

ALTER TABLE analysis_jobs
ADD COLUMN IF NOT EXISTS dwell_times JSONB DEFAULT '{}'::jsonb;

ALTER TABLE analysis_jobs
ADD COLUMN IF NOT EXISTS density_scores JSONB DEFAULT '{}'::jsonb;

ALTER TABLE analysis_jobs
ADD COLUMN IF NOT EXISTS processed_video_path TEXT;

ALTER TABLE analysis_jobs
ADD COLUMN IF NOT EXISTS heatmap_path TEXT;

ALTER TABLE analysis_jobs
ADD COLUMN IF NOT EXISTS preview_path TEXT;

ALTER TABLE zones
ADD COLUMN IF NOT EXISTS zone_type VARCHAR(60) DEFAULT 'monitoring';

ALTER TABLE zones
ADD COLUMN IF NOT EXISTS coordinates JSONB DEFAULT '[]'::jsonb;

ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';

ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    analysis_job_id INTEGER REFERENCES analysis_jobs(id) ON DELETE SET NULL,
    camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE SET NULL,
    generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    format VARCHAR(20) NOT NULL DEFAULT 'csv',
    filters JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
