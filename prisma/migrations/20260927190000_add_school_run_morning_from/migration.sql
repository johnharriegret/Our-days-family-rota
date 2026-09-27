-- Adds the configurable time from which a school-day morning requires an
-- actual adult at home (school prep + the school run). Additive and
-- defaulted, so every existing household keeps working with a sensible
-- 06:00 value until someone changes it in Settings.
ALTER TABLE "ChildcareRule" ADD COLUMN "schoolRunMorningFromLocal" TEXT DEFAULT '06:00';
