import { evaluate, mean, variance } from "mathjs";
import DatabaseManager from "./db/index.js";

// HTML table creation helper
function createHtmlTable(data, columns) {
  if (!data || data.length === 0) {
    return '<div class="no-data">No data available</div>';
  }
  
  let html = '<table class="data-table" style="border-collapse: collapse; width: 100%; margin: 10px 0;">';
  
  // Header row
  html += '<thead><tr style="background-color: #f5f5f5;">';
  columns.forEach(col => {
    html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: bold;">${col}</th>`;
  });
  html += '</tr></thead>';
  
  // Data rows
  html += '<tbody>';
  data.forEach((row, index) => {
    const bgColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
    html += `<tr style="background-color: ${bgColor};">`;
    columns.forEach(col => {
      const value = row[col] !== null && row[col] !== undefined ? row[col] : '';
      html += `<td style="border: 1px solid #ddd; padding: 8px;">${value}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  
  html += '</table>';
  return html;
}

// Create markdown table from data
function createMarkdownTable(data, columns) {
  if (!data || data.length === 0) {
    return 'No data available';
  }
  
  let markdown = '';
  
  // Header row
  markdown += '| ' + columns.join(' | ') + ' |\n';
  
  // Separator row
  markdown += '| ' + columns.map(() => '---').join(' | ') + ' |\n';
  
  // Data rows
  data.forEach(row => {
    const values = columns.map(col => {
      const value = row[col] !== null && row[col] !== undefined ? row[col] : '';
      return String(value).replace(/\|/g, '\\|'); // Escape pipes in data
    });
    markdown += '| ' + values.join(' | ') + ' |\n';
  });
  
  return markdown;
}

// Markdown table to HTML converter
function markdownTableToHtml(markdownTable) {
  const lines = markdownTable.trim().split('\n');
  if (lines.length < 2) return markdownTable; // Not a valid table
  
  const headerLine = lines[0];
  const separatorLine = lines[1];
  const dataLines = lines.slice(2);
  
  // Parse header
  const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
  
  // Check if it's a valid markdown table
  if (!separatorLine.includes('---')) return markdownTable;
  
  let html = '<table class="markdown-table" style="border-collapse: collapse; width: 100%; margin: 10px 0;">';
  
  // Header
  html += '<thead><tr style="background-color: #f5f5f5;">';
  headers.forEach(header => {
    html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: bold;">${header}</th>`;
  });
  html += '</tr></thead>';
  
  // Data rows
  html += '<tbody>';
  dataLines.forEach((line, index) => {
    const cells = line.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length > 0) {
      const bgColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
      html += `<tr style="background-color: ${bgColor};">`;
      cells.forEach(cell => {
        html += `<td style="border: 1px solid #ddd; padding: 8px;">${cell}</td>`;
      });
      html += '</tr>';
    }
  });
  html += '</tbody>';
  
  html += '</table>';
  return html;
}

// SQL Query validation helper
function validateSqlQuery(query) {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: "Query must be a non-empty string" };
  }
  
  const normalizedQuery = query.trim().toLowerCase();
  
  // Basic SQL injection prevention
  const dangerousPatterns = [
    /;\s*(drop|delete|update|insert|create|alter|truncate)/,
    /union\s+select/,
    /\/\*.*\*\//,
    /--/,
    /xp_cmdshell/,
    /sp_executesql/
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(normalizedQuery)) {
      return { valid: false, error: "Query contains potentially dangerous patterns" };
    }
  }
  
  // Check if it's a data-modifying query (UPDATE, INSERT, DELETE)
  const dataModifyingPatterns = [
    /^\s*update\s+/,
    /^\s*insert\s+/,
    /^\s*delete\s+/
  ];
  
  for (const pattern of dataModifyingPatterns) {
    if (pattern.test(normalizedQuery)) {
      return { valid: false, requiresApproval: true, error: "Data-modifying query requires approval" };
    }
  }
  
  // For now, only allow SELECT statements
  if (!normalizedQuery.startsWith('select')) {
    return { valid: false, error: "Only SELECT queries are allowed" };
  }
  
  return { valid: true };
}

// Execute SQL query using the database manager
async function executeSqlQuery(query, env = null) {
  console.log('TOOL CALLED: execute_sql with:', query);
  
  const validation = validateSqlQuery(query);
  if (!validation.valid) {
    console.log('TOOL ERROR: Query validation failed:', validation.error);
    
    // If it's a data-modifying query, return it for user approval
    if (validation.requiresApproval) {
      return { 
        requiresApproval: true, 
        query: query.trim(),
        message: "This query requires user approval before execution" 
      };
    }
    
    return { error: validation.error };
  }
  
  try {
    // Create database manager instance
    const db = new DatabaseManager(env?.DB || null);
    
    // Execute query (financial data goes to DuckDB)
    const data = await db.executeFinancialQuery(query);
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    
    console.log('TOOL RESULT: Processed data:', { dataLength: data.length, columns });
    
    // Create markdown table
    const markdownTable = createMarkdownTable(data, columns);
    
    return {
      success: true,
      data: data,
      columns: columns,
      rowCount: data.length,
      markdownTable: markdownTable,
      message: `Query executed successfully. Retrieved ${data.length} rows.`
    };
    
  } catch (err) {
    console.log('TOOL ERROR: Database query error:', err);
    return { error: `Database error: ${err.message}` };
  }
}

// Execute approved SQL query with user approval
async function executeApprovedSqlQuery(query, env = null) {
  console.log('TOOL CALLED: execute_approved_sql with:', query);
  
  try {
    // Create database manager instance
    const db = new DatabaseManager(env?.DB || null);
    
    // Execute destructive query (financial data goes to DuckDB)
    const result = await db.executeFinancialQuery(query);
    
    console.log('TOOL RESULT: Raw response:', JSON.stringify(result, null, 2));
    
    return {
      success: true,
      message: 'Query executed successfully',
      result: result
    };
    
  } catch (err) {
    console.log('TOOL ERROR: Database query error:', err);
    return { error: `Database error: ${err.message}` };
  }
}

// Schema tool removed - schema is now included in system prompt

// Export the markdown to HTML converter for frontend use
export { markdownTableToHtml };

// Tool factory function to create tools with environment access
export function createTools(env = null) {
  return [
    {
      name: "evaluate_expression",
      description: "Evaluate a numeric arithmetic expression",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"]
      },
      function: ({ expression }) => {
        console.log('TOOL CALLED: evaluate_expression with:', expression);
        try {
          const result = evaluate(expression);
          console.log('TOOL RESULT:', result);
          return { result };
        } catch (err) {
          console.log('TOOL ERROR:', err);
          return { error: String(err) };
        }
      }
    },
    {
      name: "check_mean",
      description: "Arithmetic mean of an array of numbers",
      parameters: {
        type: "object",
        properties: { values: { type: "array", items: { type: "number" } } },
        required: ["values"]
      },
      function: ({ values }) => ({ mean: mean(values) })
    },
    {
      name: "check_variance",
      description: "Sample variance of an array of numbers",
      parameters: {
        type: "object",
        properties: { values: { type: "array", items: { type: "number" } } },
        required: ["values"]
      },
      function: ({ values }) => ({ variance: variance(values) })
    },
    {
      name: "execute_sql",
      description: "Execute a SQL SELECT query against the database and return results. This tool is safe to use and should be used to fulfill user requests for data. The database contains tables like FRPAIR, FRPHOLD, FRPSEC, FRPTRAN, and sales with financial data.",
      parameters: {
        type: "object",
        properties: { 
          query: { 
            type: "string", 
            description: "The SQL SELECT query to execute (e.g., 'SELECT * FROM FRPAIR LIMIT 10')" 
          } 
        },
        required: ["query"]
      },
      function: async ({ query }) => await executeSqlQuery(query, env)
    },
    {
      name: "execute_approved_sql",
      description: "Execute a data-modifying SQL query (UPDATE, INSERT, DELETE) that has been approved by the user. This tool should only be used when the user has explicitly approved the execution.",
      parameters: {
        type: "object",
        properties: { 
          query: { 
            type: "string", 
            description: "The approved SQL query to execute (e.g., 'UPDATE FRPAIR SET NAME = \"New Name\" WHERE ACCT = \"123\"')" 
          } 
        },
        required: ["query"]
      },
      function: async ({ query }) => await executeApprovedSqlQuery(query, env)
    }
  ];
}

// Legacy export for backward compatibility
export const tools = createTools();