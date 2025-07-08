-- D1 Migration: Add parameters_schema column to agentic_workflows
-- This column will store parameter definitions as JSON for workflow execution

-- Add parameters_schema column for storing parameter definitions as JSON
ALTER TABLE agentic_workflows 
ADD COLUMN parameters_schema TEXT;

-- Add target_script_path column for future workflow execution
ALTER TABLE agentic_workflows 
ADD COLUMN target_script_path TEXT;

-- Add handler_function_name column for future workflow execution  
ALTER TABLE agentic_workflows 
ADD COLUMN handler_function_name TEXT;

-- Add output_type column to specify how workflow results should be formatted
ALTER TABLE agentic_workflows 
ADD COLUMN output_type VARCHAR(50) DEFAULT 'text_status';

-- Update existing workflows with sample parameters_schema
UPDATE agentic_workflows 
SET parameters_schema = '{"properties": {"account_id": {"type": "string", "description": "Account ID to analyze"}}, "required": ["account_id"], "system_provided": ["current_date"]}',
    output_type = 'table'
WHERE id = 1;

UPDATE agentic_workflows 
SET parameters_schema = '{"properties": {"benchmark": {"type": "string", "description": "Benchmark to compare against", "default": "SP500"}}, "required": [], "system_provided": ["report_date_previous_month"]}',
    output_type = 'table'  
WHERE id = 2;