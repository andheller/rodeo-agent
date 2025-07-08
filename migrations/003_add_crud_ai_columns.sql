-- D1 Migration: Add crud_config and ai_prompt_template columns to report_configurations
-- These columns support CRUD operations and AI insights for reports

-- Add crud_config column for storing CRUD configuration as JSON
ALTER TABLE report_configurations 
ADD COLUMN crud_config TEXT;

-- Add ai_prompt_template column for storing AI prompt templates
ALTER TABLE report_configurations 
ADD COLUMN ai_prompt_template TEXT;

-- Update the updated_at timestamp trigger to handle these new columns
-- (The trigger should already exist from initial schema, this ensures it covers new columns)