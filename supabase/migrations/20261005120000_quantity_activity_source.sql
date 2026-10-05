-- Activity log for quantity records: name who reported them and include their notes.
--
-- A quantity record without recorded_by comes from an integration, not an operator: the activity
-- text now names it from metadata.source ("VirtualFactory reported quantities ...") instead of
-- "Operator". The record's notes (e.g. the cause of a scrap) are appended to the description, so
-- the Activity page shows them.

CREATE OR REPLACE FUNCTION public.handle_quantity_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_description text;
  v_changes jsonb;
  v_action text;
  v_operation_name text;
  v_part_number text;
  v_job_number text;
  v_operator_name text;
  v_scrap_reason text;
  v_reporter text;
BEGIN
  -- Get related data
  SELECT o.operation_name, p.part_number, j.job_number, pr.full_name
  INTO v_operation_name, v_part_number, v_job_number, v_operator_name
  FROM operations o
  JOIN parts p ON p.id = o.part_id
  JOIN jobs j ON j.id = p.job_id
  LEFT JOIN profiles pr ON pr.id = COALESCE(NEW.recorded_by, OLD.recorded_by)
  WHERE o.id = COALESCE(NEW.operation_id, OLD.operation_id);

  -- Records without a user come from an integration; name it from metadata.source when known.
  v_reporter := COALESCE(
    v_operator_name,
    CASE WHEN NEW.metadata->>'source' = 'virtualfactory' THEN 'VirtualFactory' END,
    NULLIF(NEW.metadata->>'source', ''),
    'Operator');

  IF NEW.scrap_reason_id IS NOT NULL THEN
    SELECT description INTO v_scrap_reason FROM scrap_reasons WHERE id = NEW.scrap_reason_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_description := format('%s reported quantities for operation "%s" on part %s (Job %s): %s produced, %s good, %s scrap, %s rework', 
      v_reporter, v_operation_name, v_part_number, v_job_number,
      NEW.quantity_produced, NEW.quantity_good, NEW.quantity_scrap, NEW.quantity_rework);
    
    IF NEW.quantity_scrap > 0 AND v_scrap_reason IS NOT NULL THEN
      v_description := v_description || format(' (Scrap reason: %s)', v_scrap_reason);
    END IF;

    IF NULLIF(btrim(NEW.notes), '') IS NOT NULL THEN
      v_description := v_description || ' - ' || btrim(NEW.notes);
    END IF;
    
    v_changes := jsonb_build_object('new', to_jsonb(NEW));
    
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_description := format('Quantities updated for operation "%s" on part %s (Job %s)', 
      v_operation_name, v_part_number, v_job_number);
    v_changes := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
    
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_description := format('Quantity record deleted for operation "%s" on part %s (Job %s)', 
      v_operation_name, v_part_number, v_job_number);
    v_changes := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  PERFORM log_activity_and_webhook(
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    COALESCE(NEW.recorded_by, OLD.recorded_by, auth.uid()),
    v_action,
    'quantity',
    COALESCE(NEW.id, OLD.id),
    format('%s - %s (%s)', v_operation_name, v_part_number, v_job_number),
    v_description,
    v_changes,
    jsonb_build_object(
      'job_number', v_job_number,
      'part_number', v_part_number,
      'operation', v_operation_name,
      'operator', v_operator_name,
      'produced', COALESCE(NEW.quantity_produced, OLD.quantity_produced),
      'good', COALESCE(NEW.quantity_good, OLD.quantity_good),
      'scrap', COALESCE(NEW.quantity_scrap, OLD.quantity_scrap),
      'rework', COALESCE(NEW.quantity_rework, OLD.quantity_rework),
      'scrap_reason', v_scrap_reason
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;
