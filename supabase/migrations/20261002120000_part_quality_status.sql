-- Part quality and the good quantity a job needs.
--
-- parts.quality_status records an inspection verdict: pending (not inspected yet), good or bad.
-- jobs.required_quantity is the number of good units the job must deliver. When it is set, a job
-- completes only once its completed good parts reach it: a part rejected as bad does not count, so
-- the job stays in progress until a replacement part is completed as good. Jobs without
-- required_quantity keep the existing rule (completed when every part is completed).

ALTER TABLE public.parts
  ADD COLUMN IF NOT EXISTS quality_status text
  CONSTRAINT parts_quality_status_check CHECK (quality_status IN ('pending', 'good', 'bad'));

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS required_quantity integer
  CONSTRAINT jobs_required_quantity_check CHECK (required_quantity > 0);

COMMENT ON COLUMN public.parts.quality_status IS
  'Inspection verdict: pending, good or bad. NULL when the part is not quality tracked.';
COMMENT ON COLUMN public.jobs.required_quantity IS
  'Good units the job must deliver. When set, the job completes only once its completed good parts reach it.';

CREATE OR REPLACE FUNCTION public.refresh_production_job(p_tenant_id uuid, p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM 1 FROM public.jobs WHERE id = p_job_id AND tenant_id = p_tenant_id FOR UPDATE;
  UPDATE public.parts p SET status = n.status, current_cell_id = n.cell_id
  FROM (
    SELECT p.id,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.operations o WHERE o.part_id = p.id AND o.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.operations o WHERE o.part_id = p.id AND o.deleted_at IS NULL AND o.status <> 'completed')
          THEN 'completed'::public.job_status
        WHEN EXISTS (SELECT 1 FROM public.operations o WHERE o.part_id = p.id AND o.deleted_at IS NULL AND o.status = 'in_progress')
          THEN 'in_progress'::public.job_status
        ELSE p.status END AS status,
      (SELECT o.cell_id FROM public.operations o JOIN public.cells c ON c.id = o.cell_id
        WHERE o.part_id = p.id AND o.tenant_id = p_tenant_id AND o.deleted_at IS NULL AND o.status = 'in_progress'
        ORDER BY c.sequence, o.sequence, o.id LIMIT 1) AS cell_id
    FROM public.parts p
    WHERE p.job_id = p_job_id AND p.tenant_id = p_tenant_id AND p.deleted_at IS NULL
  ) n
  WHERE n.id = p.id AND (p.status, p.current_cell_id) IS DISTINCT FROM (n.status, n.cell_id);
  UPDATE public.jobs j SET status = n.status, current_cell_id = n.cell_id
  FROM (
    SELECT j.id,
      CASE
        -- Quality tracked: completed once the completed good parts reach the required quantity and
        -- no part that still counts (anything not rejected as bad) is unfinished.
        WHEN j.required_quantity IS NOT NULL THEN
          CASE
            WHEN (SELECT COALESCE(SUM(p.quantity), 0) FROM public.parts p
                   WHERE p.job_id = j.id AND p.deleted_at IS NULL
                     AND p.status = 'completed' AND p.quality_status = 'good') >= j.required_quantity
             AND NOT EXISTS (SELECT 1 FROM public.parts p
                   WHERE p.job_id = j.id AND p.deleted_at IS NULL
                     AND p.status <> 'completed' AND p.quality_status IS DISTINCT FROM 'bad')
              THEN 'completed'::public.job_status
            WHEN EXISTS (SELECT 1 FROM public.parts p WHERE p.job_id = j.id AND p.deleted_at IS NULL AND p.status = 'in_progress')
              THEN 'in_progress'::public.job_status
            -- Every part is done but good parts are still missing: waiting for a replacement.
            WHEN j.status = 'completed'
              THEN 'in_progress'::public.job_status
            ELSE j.status END
        WHEN EXISTS (SELECT 1 FROM public.parts p WHERE p.job_id = j.id AND p.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.job_id = j.id AND p.deleted_at IS NULL AND p.status <> 'completed')
          THEN 'completed'::public.job_status
        WHEN EXISTS (SELECT 1 FROM public.parts p WHERE p.job_id = j.id AND p.deleted_at IS NULL AND p.status = 'in_progress')
          THEN 'in_progress'::public.job_status
        ELSE j.status END AS status,
      (SELECT p.current_cell_id FROM public.parts p JOIN public.cells c ON c.id = p.current_cell_id
        WHERE p.job_id = j.id AND p.tenant_id = p_tenant_id AND p.deleted_at IS NULL
        ORDER BY c.sequence, p.id LIMIT 1) AS cell_id
    FROM public.jobs j WHERE j.id = p_job_id AND j.tenant_id = p_tenant_id
  ) n
  WHERE n.id = j.id AND (j.status, j.current_cell_id) IS DISTINCT FROM (n.status, n.cell_id);
END;
$function$;
