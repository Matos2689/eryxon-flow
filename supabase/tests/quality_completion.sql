-- Rollback-only tests: a job with required_quantity completes only once its completed good parts reach it.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.job_status(job uuid) RETURNS text LANGUAGE sql AS $$ SELECT status::text FROM jobs WHERE id=job $$;
CREATE FUNCTION pg_temp.refresh(job uuid) RETURNS void LANGUAGE sql AS $$ SELECT refresh_production_job(current_setting('test.tenant')::uuid,job) $$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('f1000000-0000-0000-0000-000000000001','quality@example.invalid','{"username":"quality","full_name":"Quality Inspector"}');
SELECT set_config('test.tenant',tenant_id::text,true) FROM profiles WHERE id='f1000000-0000-0000-0000-000000000001';
INSERT INTO cells(id,tenant_id,name,sequence) VALUES('f2000000-0000-0000-0000-000000000001',current_setting('test.tenant')::uuid,'Inspection',1);
INSERT INTO jobs(id,tenant_id,job_number,status,required_quantity) VALUES
 ('f3000000-0000-0000-0000-000000000001',current_setting('test.tenant')::uuid,'QUALITY','in_progress',2),
 ('f3000000-0000-0000-0000-000000000002',current_setting('test.tenant')::uuid,'UNTRACKED','in_progress',NULL);
-- QUALITY: part 1 good, part 2 rejected as bad, part 3 its replacement (still in production).
INSERT INTO parts(id,tenant_id,job_id,part_number,material,quantity,status,quality_status) VALUES
 ('f4000000-0000-0000-0000-000000000001',current_setting('test.tenant')::uuid,'f3000000-0000-0000-0000-000000000001','Q-01','steel',1,'completed','good'),
 ('f4000000-0000-0000-0000-000000000002',current_setting('test.tenant')::uuid,'f3000000-0000-0000-0000-000000000001','Q-02','steel',1,'completed','bad'),
 ('f4000000-0000-0000-0000-000000000003',current_setting('test.tenant')::uuid,'f3000000-0000-0000-0000-000000000001','Q-03','steel',1,'in_progress','pending'),
 ('f4000000-0000-0000-0000-000000000004',current_setting('test.tenant')::uuid,'f3000000-0000-0000-0000-000000000002','U-01','steel',1,'completed',NULL);
INSERT INTO operations(id,tenant_id,part_id,cell_id,operation_name,sequence,estimated_time,status) VALUES
 ('f5000000-0000-0000-0000-000000000001',current_setting('test.tenant')::uuid,'f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','CMM',1,1,'completed'),
 ('f5000000-0000-0000-0000-000000000002',current_setting('test.tenant')::uuid,'f4000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001','CMM',1,1,'completed'),
 ('f5000000-0000-0000-0000-000000000003',current_setting('test.tenant')::uuid,'f4000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000001','CMM',1,1,'in_progress'),
 ('f5000000-0000-0000-0000-000000000004',current_setting('test.tenant')::uuid,'f4000000-0000-0000-0000-000000000004','f2000000-0000-0000-0000-000000000001','CMM',1,1,'completed');

SELECT pg_temp.refresh('f3000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true(pg_temp.job_status('f3000000-0000-0000-0000-000000000001')='in_progress','1 good of 2 while the replacement is produced: in progress');

-- The replacement's last operation completes before its verdict arrives: still 1 good of 2.
UPDATE operations SET status='completed' WHERE id='f5000000-0000-0000-0000-000000000003';
SELECT pg_temp.refresh('f3000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true(pg_temp.job_status('f3000000-0000-0000-0000-000000000001')='in_progress','every part done but a good part missing: in progress, not completed');

-- A job that was completed before reopens while good parts are missing.
UPDATE jobs SET status='completed' WHERE id='f3000000-0000-0000-0000-000000000001';
SELECT pg_temp.refresh('f3000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true(pg_temp.job_status('f3000000-0000-0000-0000-000000000001')='in_progress','a completed job short of good parts goes back to in progress');

UPDATE parts SET quality_status='good' WHERE id='f4000000-0000-0000-0000-000000000003';
SELECT pg_temp.refresh('f3000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true(pg_temp.job_status('f3000000-0000-0000-0000-000000000001')='completed','2 good of 2: completed');

-- Without required_quantity the existing rule applies: every part completed.
SELECT pg_temp.refresh('f3000000-0000-0000-0000-000000000002');
SELECT pg_temp.assert_true(pg_temp.job_status('f3000000-0000-0000-0000-000000000002')='completed','untracked job completes when every part is completed');

DO $$ BEGIN
  INSERT INTO parts(tenant_id,job_id,part_number,material,quality_status)
  VALUES (current_setting('test.tenant')::uuid,'f3000000-0000-0000-0000-000000000001','Q-BAD','steel','scrap');
  RAISE EXCEPTION 'quality_status accepted a value outside pending/good/bad';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

ROLLBACK;
