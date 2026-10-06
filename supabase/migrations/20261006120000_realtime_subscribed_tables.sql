-- Publish the tables the UI already subscribes to over Realtime.
--
-- A Realtime channel whose postgres_changes bindings include a table outside the
-- supabase_realtime publication is rejected as a whole ("Unable to subscribe to
-- changes with given parameters"), so its other bindings stop delivering too.
-- That silently froze:
--   - cells:                QRM dashboard and stage WIP (subscribed together with operations)
--   - operation_quantities,
--     part_placements:      operator terminal (subscribed together with operations etc.)
--   - assignments:          admin Assignments page
-- All four are tenant-scoped with RLS, like the tables already published, so
-- Realtime only delivers rows the subscriber may read.

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['cells', 'assignments', 'operation_quantities', 'part_placements']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.%I', v_table);
    END IF;
  END LOOP;
END
$$;
