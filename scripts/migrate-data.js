// Data migration script to seed D1 with existing data from DuckDB
import DatabaseManager from '../src/db/index.js';

// This script will migrate the agent-specific data from DuckDB to D1
// FRP tables remain in DuckDB, but users, report_configurations, and agentic_workflows move to D1

async function migrateData() {
  
  try {
    // Note: This script is designed to run locally with wrangler dev
    // For production, you would use the D1 binding from the worker environment
    
    // First, let's create some sample data since we're working with dummy reports
    const sampleUsers = [
      {
        username: 'admin',
        hashed_password: '$2b$10$example.hash.for.admin.password', // In real scenario, use bcrypt
        role: 'admin'
      },
      {
        username: 'analyst',
        hashed_password: '$2b$10$example.hash.for.analyst.password',
        role: 'user'
      }
    ];

    const sampleReportConfigs = [
      {
        label: 'Portfolio Summary',
        query_template: 'SELECT ACCT, NAME, ACTIVE FROM FRPAIR WHERE ACTIVE = \'Open\'',
        column_definitions: JSON.stringify([
          { name: 'ACCT', type: 'VARCHAR', label: 'Account ID' },
          { name: 'NAME', type: 'VARCHAR', label: 'Account Name' },
          { name: 'ACTIVE', type: 'VARCHAR', label: 'Status' }
        ]),
        parameter_definitions: JSON.stringify([])
      },
      {
        label: 'Holdings Report',
        query_template: 'SELECT h.AACCT, h.HID, s.NAMETKR, h.HUNITS, h.HPRINCIPAL FROM FRPHOLD h JOIN FRPSEC s ON h.HID = s.ID WHERE h.AACCT = ?',
        column_definitions: JSON.stringify([
          { name: 'AACCT', type: 'VARCHAR', label: 'Account' },
          { name: 'HID', type: 'VARCHAR', label: 'Security ID' },
          { name: 'NAMETKR', type: 'VARCHAR', label: 'Security Name' },
          { name: 'HUNITS', type: 'DOUBLE', label: 'Units' },
          { name: 'HPRINCIPAL', type: 'DOUBLE', label: 'Market Value' }
        ]),
        parameter_definitions: JSON.stringify([
          { name: 'account_id', type: 'VARCHAR', label: 'Account ID', required: true }
        ])
      },
      {
        label: 'Transaction History',
        query_template: 'SELECT t.AACCT, t.TDATE, t.TCODE, s.NAMETKR, t.TUNITS, t.TPRINCIPAL FROM FRPTRAN t JOIN FRPSEC s ON t.HID = s.ID WHERE t.AACCT = ? ORDER BY t.TDATE DESC',
        column_definitions: JSON.stringify([
          { name: 'AACCT', type: 'VARCHAR', label: 'Account' },
          { name: 'TDATE', type: 'DATE', label: 'Date' },
          { name: 'TCODE', type: 'VARCHAR', label: 'Transaction Type' },
          { name: 'NAMETKR', type: 'VARCHAR', label: 'Security' },
          { name: 'TUNITS', type: 'DOUBLE', label: 'Units' },
          { name: 'TPRINCIPAL', type: 'DOUBLE', label: 'Amount' }
        ]),
        parameter_definitions: JSON.stringify([
          { name: 'account_id', type: 'VARCHAR', label: 'Account ID', required: true }
        ])
      }
    ];

    const sampleWorkflows = [
      {
        name: 'Daily Portfolio Analysis',
        description: 'Automated daily analysis of portfolio performance and risk metrics',
        workflow_data: JSON.stringify({
          steps: [
            { type: 'data_collection', query: 'SELECT * FROM FRPHOLD WHERE ADATE = CURRENT_DATE' },
            { type: 'calculation', metric: 'portfolio_value' },
            { type: 'risk_analysis', method: 'var_calculation' },
            { type: 'report_generation', template: 'daily_summary' }
          ],
          schedule: 'daily',
          notifications: ['admin@example.com']
        }),
        status: 'active'
      },
      {
        name: 'Monthly Performance Review',
        description: 'Monthly portfolio performance analysis and benchmarking',
        workflow_data: JSON.stringify({
          steps: [
            { type: 'data_collection', query: 'SELECT * FROM FRPTRAN WHERE TDATE >= DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH)' },
            { type: 'performance_calculation', benchmark: 'SP500' },
            { type: 'comparison_analysis', period: 'month' },
            { type: 'report_generation', template: 'monthly_performance' }
          ],
          schedule: 'monthly',
          notifications: ['admin@example.com', 'analyst@example.com']
        }),
        status: 'active'
      }
    ];

    // Create SQL insert scripts for D1
    
    let insertScript = '';
    
    // Insert users
    insertScript += '-- Insert sample users\n';
    sampleUsers.forEach(user => {
      insertScript += `INSERT INTO users (username, hashed_password, role) VALUES ('${user.username}', '${user.hashed_password}', '${user.role}');\n`;
    });
    
    insertScript += '\n-- Insert sample report configurations\n';
    sampleReportConfigs.forEach(config => {
      const escapedQueryTemplate = config.query_template.replace(/'/g, "''");
      const escapedColumnDefs = config.column_definitions.replace(/'/g, "''");
      const escapedParamDefs = config.parameter_definitions.replace(/'/g, "''");
      
      insertScript += `INSERT INTO report_configurations (label, query_template, column_definitions, parameter_definitions) VALUES ('${config.label}', '${escapedQueryTemplate}', '${escapedColumnDefs}', '${escapedParamDefs}');\n`;
    });
    
    insertScript += '\n-- Insert sample workflows\n';
    sampleWorkflows.forEach(workflow => {
      const escapedWorkflowData = workflow.workflow_data.replace(/'/g, "''");
      
      insertScript += `INSERT INTO agentic_workflows (name, description, workflow_data, status) VALUES ('${workflow.name}', '${workflow.description}', '${escapedWorkflowData}', '${workflow.status}');\n`;
    });
    
    // Write the migration script
    const fs = await import('fs');
    fs.writeFileSync('./migrations/002_seed_data.sql', insertScript);
    
    
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

// Run the migration
migrateData();