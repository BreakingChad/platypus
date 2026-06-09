-- 0046_stage_label — eReg moved to the 2027 roadmap, so the pipeline stage
-- drops the "/ eReg" suffix. Existing org data only; the 0002/0005b seed JSON
-- still carries the old label for brand-new orgs and gets corrected at the
-- next seed-function revision (rename in Stage Designer meanwhile).

update public.pipeline_stages
set label = 'Regulatory'
where label = 'Regulatory / eReg';
