-- Fix notebook query templates to use correct single quotes

UPDATE notebook_configurations 
SET steps = REPLACE(REPLACE(steps, ''''{', '''{'), '}''''', '}''')
WHERE name IN ('Monthly Portfolio Analysis', 'Daily Data Quality Check', 'Weekly Reconciliation Report');