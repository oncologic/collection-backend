CREATE OR REPLACE VIEW business_units AS
SELECT * FROM organizations;

CREATE OR REPLACE VIEW business_unit_members AS
SELECT * FROM organization_members;

CREATE OR REPLACE VIEW business_unit_events AS
SELECT * FROM organization_events;

CREATE OR REPLACE VIEW business_unit_resources AS
SELECT * FROM organization_resources;

CREATE OR REPLACE VIEW business_unit_surveys AS
SELECT * FROM organization_surveys;

CREATE OR REPLACE VIEW business_unit_tags AS
SELECT * FROM organization_tags;

CREATE OR REPLACE VIEW business_unit_opportunities AS
SELECT * FROM organization_opportunities;
