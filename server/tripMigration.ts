import type { PoolClient } from "pg";

/**
 * Columns that let any field note (trip) own video clips. Idempotent, so it
 * runs on every start like the other startup migrations.
 */
export const TRIP_VIDEO_COLUMNS_SQL = `
  ALTER TABLE field_notes
    ADD COLUMN IF NOT EXISTS start_time timestamp,
    ADD COLUMN IF NOT EXISTS end_time timestamp,
    ADD COLUMN IF NOT EXISTS playback jsonb;
  ALTER TABLE trailcam_projects ADD COLUMN IF NOT EXISTS migrated_at timestamp;
  ALTER TABLE video_clips
    ADD COLUMN IF NOT EXISTS field_note_id varchar REFERENCES field_notes(id) ON DELETE CASCADE;
  ALTER TABLE video_clips ALTER COLUMN project_id DROP NOT NULL;
  CREATE INDEX IF NOT EXISTS video_clips_field_note_id_idx ON video_clips (field_note_id);
`;

/**
 * Copies each TrailCam Studio project into field_notes as a trip with the
 * same id, so clips, links and MCP project ids keep working. Studio projects
 * never stored an owner; they go to the account that owns the most trips
 * (Big Miles has one Studio user). The sync offset and camera angle move from
 * gpxData to the playback column. Projects already copied are skipped.
 */
export const COPY_STUDIO_PROJECTS_SQL = `
  INSERT INTO field_notes (
    id, user_id, title, description, trip_type, date, distance, elevation_gain,
    gpx_data, start_time, end_time, playback, created_at
  )
  SELECT
    p.id,
    owner.user_id,
    p.title,
    COALESCE(p.description, ''),
    '{}'::text[],
    COALESCE(p.start_time, p.created_at),
    CASE WHEN jsonb_typeof(p.gpx_data->'distance') = 'number'
      THEN round((p.gpx_data->>'distance')::numeric, 1)::real END,
    CASE WHEN jsonb_typeof(p.gpx_data->'elevationGain') = 'number'
      THEN round((p.gpx_data->>'elevationGain')::numeric)::real END,
    p.gpx_data - 'syncOffsetSeconds' - 'cameraAngle',
    p.start_time,
    p.end_time,
    NULLIF(jsonb_strip_nulls(jsonb_build_object(
      'syncOffsetSeconds', p.gpx_data->'syncOffsetSeconds',
      'cameraAngle', p.gpx_data->'cameraAngle'
    )), '{}'::jsonb),
    p.created_at
  FROM trailcam_projects p
  CROSS JOIN (
    SELECT user_id FROM field_notes
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    ORDER BY count(*) DESC, user_id
    LIMIT 1
  ) owner
  WHERE p.migrated_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM field_notes f WHERE f.id = p.id);
`;

export const MARK_STUDIO_PROJECTS_SQL = `
  UPDATE trailcam_projects p SET migrated_at = now()
  WHERE p.migrated_at IS NULL
    AND EXISTS (SELECT 1 FROM field_notes f WHERE f.id = p.id);
`;

export const LINK_CLIPS_TO_TRIPS_SQL = `
  UPDATE video_clips c SET field_note_id = c.project_id
  WHERE c.field_note_id IS NULL
    AND c.project_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM field_notes f WHERE f.id = c.project_id);
`;

/** Adds the trip video columns, then moves any unmigrated Studio projects in one transaction. */
export async function migrateStudioProjectsToTrips(client: PoolClient): Promise<{ trips: number; clips: number }> {
  await client.query(TRIP_VIDEO_COLUMNS_SQL);
  await client.query("BEGIN");
  try {
    const copied = await client.query(COPY_STUDIO_PROJECTS_SQL);
    await client.query(MARK_STUDIO_PROJECTS_SQL);
    const linked = await client.query(LINK_CLIPS_TO_TRIPS_SQL);
    await client.query("COMMIT");
    return { trips: copied.rowCount ?? 0, clips: linked.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
