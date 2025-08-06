-- D1 Migration: Seed sample notebook configurations
-- Provides example notebook configurations for testing

-- Sample notebook configuration for monthly portfolio analysis
INSERT INTO notebook_configurations (name, description, processing_period, steps, variables, status)
VALUES (
    'Monthly Portfolio Analysis',
    'Comprehensive monthly analysis of portfolio holdings, performance, and risk metrics',
    'monthly',
    '[
        {
            "id": "fetch_holdings",
            "label": "Fetch Current Holdings",
            "query_template": "SELECT * FROM frpindx WHERE IDATE BETWEEN '{processing_month}-01' AND '{processing_month}-31' LIMIT 100",
            "ai_prompt": "Analyze the portfolio holdings data. Summarize key positions, sector allocation, and any notable changes from previous periods. Highlight any positions that seem unusual or require attention.",
            "auto_run_ai": true
        },
        {
            "id": "calculate_performance",
            "label": "Calculate Performance Metrics",
            "query_template": "SELECT INDX as symbol, COUNT(*) as position_count FROM frpindx WHERE IDATE BETWEEN '{processing_month}-01' AND '{processing_month}-31' GROUP BY INDX ORDER BY position_count DESC LIMIT 20",
            "ai_prompt": "Review the performance metrics and identify top performing positions. Look for any outliers or positions that need investigation.",
            "auto_run_ai": false
        },
        {
            "id": "risk_analysis",
            "label": "Risk Analysis",
            "query_template": "SELECT INDX as symbol, COUNT(*) as data_points FROM frpindx WHERE IDATE BETWEEN '{processing_month}-01' AND '{processing_month}-31' GROUP BY INDX HAVING COUNT(*) > 1 ORDER BY data_points DESC LIMIT 15",
            "ai_prompt": "Examine the risk metrics and volatility patterns. Flag any positions with concerning risk profiles or unusual volatility patterns that require attention.",
            "auto_run_ai": true
        }
    ]',
    '{"processing_month": "2024-01"}',
    'active'
);

-- Sample notebook configuration for daily processing
INSERT INTO notebook_configurations (name, description, processing_period, steps, variables, status)
VALUES (
    'Daily Data Quality Check',
    'Daily validation of data integrity and quality checks for incoming financial data',
    'daily',
    '[
        {
            "id": "data_completeness",
            "label": "Check Data Completeness",
            "query_template": "SELECT COUNT(*) as total_records, COUNT(DISTINCT INDX) as unique_symbols FROM frpindx WHERE IDATE = '{processing_date}'",
            "ai_prompt": "Review the data completeness metrics. Are we seeing the expected volume of data? Are there any missing symbols or unusual patterns?",
            "auto_run_ai": true
        },
        {
            "id": "outlier_detection",
            "label": "Detect Data Outliers",
            "query_template": "SELECT INDX as symbol, IPRICE, IINC, IRET FROM frpindx WHERE IDATE = '{processing_date}' ORDER BY INDX LIMIT 10",
            "ai_prompt": "Examine these outlier records. Are these legitimate large positions or potential data errors that need investigation?",
            "auto_run_ai": false
        }
    ]',
    '{"processing_date": "2024-01-15"}',
    'active'
);

-- Sample notebook configuration for weekly reconciliation
INSERT INTO notebook_configurations (name, description, processing_period, steps, variables, status)
VALUES (
    'Weekly Reconciliation Report',
    'Weekly reconciliation of positions and cash flows',
    'weekly', 
    '[
        {
            "id": "position_summary",
            "label": "Position Summary",
            "query_template": "SELECT INDX as symbol, COUNT(*) as position_count FROM frpindx WHERE IDATE BETWEEN '{week_start}' AND '{week_end}' GROUP BY INDX ORDER BY position_count DESC LIMIT 25",
            "ai_prompt": "Review the weekly position changes. Identify significant position movements and any symbols with unusual activity.",
            "auto_run_ai": true
        }
    ]',
    '{"week_start": "2024-01-01", "week_end": "2024-01-07"}',
    'draft'
);