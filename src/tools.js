import { evaluate, mean, variance } from "mathjs";
import { z } from "zod";
import DatabaseManager from "./db/index.js";
import { AI_CONFIG, withTimeout } from "./ai-config.js";

// Load knowledge base data
import knowledgeBaseData from './knowledge-base-data.js';

function loadKnowledgeBase() {
  return knowledgeBaseData;
}

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



// Common table and column suggestions
const commonTables = [
  { name: 'frpindx', description: 'Financial index data with price and return information' },
  { name: 'frpair', description: 'Account information and relationships' },
  { name: 'frpsec', description: 'Security master data with asset information' }
];

const commonColumns = {
  frpindx: ['INDX', 'IDATE', 'IPRICE', 'IINC', 'IRET'],
  frpair: ['ACCOUNT_TYPE', 'CLIENT_ID', 'PORTFOLIO_ID'],
  frpsec: ['SECURITY_ID', 'FACTOR', 'BETA', 'ASSET_TYPE']
};

// Enhanced SQL Query validation helper with suggestions
function validateSqlQuery(query) {
  if (!query || typeof query !== 'string') {
    return { 
      valid: false, 
      error: "Query must be a non-empty string",
      suggestions: [
        {
          category: "Getting Started",
          items: [
            "SELECT * FROM frpindx LIMIT 10",
            "SELECT COUNT(*) FROM frpair",
            "SELECT DISTINCT INDX FROM frpindx"
          ]
        }
      ]
    };
  }
  
  const normalizedQuery = query.trim().toLowerCase();
  const originalQuery = query.trim();
  
  // Check for empty query
  if (normalizedQuery.length === 0) {
    return {
      valid: false,
      error: "Query cannot be empty",
      suggestions: [
        {
          category: "Sample Queries",
          items: [
            "SELECT * FROM frpindx LIMIT 5",
            "SELECT COUNT(*) FROM frpair GROUP BY ACCOUNT_TYPE"
          ]
        }
      ]
    };
  }
  
  // Basic SQL injection prevention with helpful suggestions
  const dangerousPatterns = [
    { pattern: /;\s*(drop|delete|update|insert|create|alter|truncate)/, type: 'multiple_statements' },
    { pattern: /union\s+select/, type: 'union_injection' },
    { pattern: /\/\*.*\*\//, type: 'comments' },
    { pattern: /--/, type: 'comments' },
    { pattern: /xp_cmdshell/, type: 'system_calls' },
    { pattern: /sp_executesql/, type: 'stored_procedures' }
  ];
  
  for (const { pattern, type } of dangerousPatterns) {
    if (pattern.test(normalizedQuery)) {
      let errorMsg = "Query contains potentially dangerous patterns";
      let suggestions = [];
      
      switch (type) {
        case 'multiple_statements':
          errorMsg = "Multiple SQL statements detected. Only single SELECT queries are allowed.";
          suggestions = [
            {
              category: "Safe Alternatives",
              items: [
                "Run queries separately",
                "Use subqueries instead: SELECT * FROM (SELECT ...) AS subquery"
              ]
            }
          ];
          break;
        case 'comments':
          errorMsg = "SQL comments are not allowed for security reasons";
          suggestions = [
            {
              category: "Instead of Comments",
              items: [
                "Remove -- comments",
                "Remove /* */ comments",
                "Use clear column aliases: SELECT col AS meaningful_name"
              ]
            }
          ];
          break;
      }
      
      return { valid: false, error: errorMsg, suggestions };
    }
  }
  
  // Check if it's a data-modifying query (UPDATE, INSERT, DELETE)
  const dataModifyingPatterns = [
    { pattern: /^\s*update\s+/, type: 'UPDATE' },
    { pattern: /^\s*insert\s+/, type: 'INSERT' },
    { pattern: /^\s*delete\s+/, type: 'DELETE' }
  ];
  
  for (const { pattern, type } of dataModifyingPatterns) {
    if (pattern.test(normalizedQuery)) {
      return { 
        valid: false, 
        requiresApproval: true, 
        error: `${type} queries require user approval`,
        suggestions: [
          {
            category: "Data Modification Workflow",
            items: [
              `Use prepare_sql_for_user tool for ${type} operations`,
              "First query the data to see current values",
              "Consider if SELECT query would meet your needs instead"
            ]
          },
          {
            category: "Preview Data First",
            items: [
              originalQuery.includes('WHERE') 
                ? `SELECT * FROM ${originalQuery.match(/(?:update|delete from|insert into)\s+(\w+)/i)?.[1] || 'table'} WHERE ${originalQuery.match(/where\s+(.+?)(?:\s+set|\s*$)/i)?.[1] || 'condition'}`
                : `SELECT * FROM ${originalQuery.match(/(?:update|delete from|insert into)\s+(\w+)/i)?.[1] || 'table'} LIMIT 10`
            ]
          }
        ]
      };
    }
  }
  
  // Enhanced validation for non-SELECT queries
  if (!normalizedQuery.startsWith('select')) {
    const detectedType = normalizedQuery.split(/\s+/)[0].toUpperCase();
    
    return { 
      valid: false, 
      error: `${detectedType} queries are not allowed. Only SELECT queries are permitted.`,
      suggestions: [
        {
          category: "Query Type Fix",
          items: [
            "Use SELECT to query data",
            "Use prepare_sql_for_user for data modifications",
            "Start your query with SELECT"
          ]
        },
        {
          category: "Common SELECT Patterns",
          items: [
            "SELECT * FROM table_name LIMIT 10",
            "SELECT column1, column2 FROM table_name WHERE condition",
            "SELECT COUNT(*) FROM table_name GROUP BY column"
          ]
        }
      ]
    };
  }
  
  // Table name validation with suggestions
  const tableMatch = normalizedQuery.match(/from\s+(\w+)/);
  if (tableMatch) {
    const tableName = tableMatch[1].toLowerCase();
    const knownTable = commonTables.find(t => t.name.toLowerCase() === tableName);
    
    if (!knownTable) {
      return {
        valid: false,
        error: `Table '${tableName}' might not exist or be accessible`,
        suggestions: [
          {
            category: "Available Tables",
            items: commonTables.map(t => `${t.name} - ${t.description}`)
          },
          {
            category: "Example Queries",
            items: commonTables.map(t => `SELECT * FROM ${t.name} LIMIT 5`)
          }
        ]
      };
    }
  }
  
  // Performance suggestions for potentially slow queries
  const performanceWarnings = [];
  if (!normalizedQuery.includes('limit') && normalizedQuery.includes('select *')) {
    performanceWarnings.push("Consider adding LIMIT clause to prevent returning large datasets");
  }
  
  if (normalizedQuery.includes('select *') && normalizedQuery.includes('where')) {
    performanceWarnings.push("Consider selecting specific columns instead of * for better performance");
  }
  
  const result = { valid: true };
  
  if (performanceWarnings.length > 0) {
    result.warnings = performanceWarnings;
    result.suggestions = [
      {
        category: "Performance Tips",
        items: performanceWarnings
      }
    ];
  }
  
  return result;
}

// Helper function to analyze column data types and get statistics
function analyzeColumns(data, columns) {
  const stats = {};
  
  for (const col of columns) {
    const values = data.map(row => row[col]).filter(v => v !== null && v !== undefined && v !== '');
    if (values.length === 0) continue;
    
    // Detect column type
    const firstValue = values[0];
    const isNumeric = !isNaN(parseFloat(firstValue)) && isFinite(firstValue);
    const isDate = !isNaN(Date.parse(firstValue));
    
    if (isNumeric) {
      const numbers = values.map(v => parseFloat(v));
      stats[col] = {
        type: 'numeric',
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        avg: numbers.reduce((a, b) => a + b, 0) / numbers.length,
        distinctCount: new Set(values).size
      };
    } else if (isDate) {
      const dates = values.map(v => new Date(v));
      stats[col] = {
        type: 'date',
        earliest: new Date(Math.min(...dates)),
        latest: new Date(Math.max(...dates)),
        distinctCount: new Set(values).size
      };
    } else {
      stats[col] = {
        type: 'text',
        distinctCount: new Set(values).size,
        maxLength: Math.max(...values.map(v => v.toString().length)),
        sample: values.slice(0, 3)
      };
    }
  }
  
  return stats;
}

// Helper function to generate insights from data
function generateDataInsights(data, columns, stats) {
  const insights = [];
  
  // Dataset size insights
  if (data.length > 1000) {
    insights.push(`Large dataset with ${data.length.toLocaleString()} rows`);
  }
  
  // Column insights
  const numericCols = Object.keys(stats).filter(col => stats[col].type === 'numeric');
  const dateCols = Object.keys(stats).filter(col => stats[col].type === 'date');
  
  if (numericCols.length > 0) {
    insights.push(`${numericCols.length} numeric column(s): ${numericCols.join(', ')}`);
  }
  
  if (dateCols.length > 0) {
    const dateCol = dateCols[0];
    const dateRange = stats[dateCol];
    insights.push(`Date range: ${dateRange.earliest.toISOString().split('T')[0]} to ${dateRange.latest.toISOString().split('T')[0]}`);
  }
  
  // Distinct value insights
  const highCardinalityCols = Object.keys(stats).filter(col => 
    stats[col].distinctCount === data.length || stats[col].distinctCount > data.length * 0.9
  );
  if (highCardinalityCols.length > 0) {
    insights.push(`Unique identifier columns: ${highCardinalityCols.join(', ')}`);
  }
  
  return insights;
}

// Execute SQL query using the database manager
async function executeSqlQuery(query, env = null) {
  
  const validation = validateSqlQuery(query);
  if (!validation.valid) {
    
    // If it's a data-modifying query, return it for user approval
    if (validation.requiresApproval) {
      return { 
        requiresApproval: true, 
        query: query.trim(),
        message: "This query will be prepared for user approval" 
      };
    }
    
    return { 
      error: validation.error,
      suggestions: validation.suggestions || []
    };
  }
  
  try {
    // Create database manager instance
    const db = new DatabaseManager(env?.DB || null, null, env);
    
    // Execute query (financial data goes to DuckDB)
    const data = await db.executeFinancialQuery(query);
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    const totalRows = data.length;
    
    // Limit data to maximum 10 rows for agent processing
    const limitedData = data.slice(0, 10);
    
    // Enhanced response for large datasets
    if (totalRows > 10) {
      return {
        success: true,
        data: limitedData,
        columns: columns,
        rowCount: totalRows,
        limitedTo: 10,
        message: `Query executed successfully. Retrieved ${totalRows} rows (showing first 10). You can re-run the same or modified query to see different data - no need to refer back to these results unless helpful for your analysis.`,
        suggestions: [
          {
            category: "Query Refinement",
            items: [
              `Add "LIMIT ${Math.min(50, totalRows)}" to see more rows`,
              `Add "ORDER BY column_name" to see different data patterns`,
              `Use "WHERE conditions" to filter specific data`,
              `Try "SELECT COUNT(*) FROM (${query.replace(/;$/, '')}) AS subquery" to get exact count`
            ]
          }
        ]
      };
    }
    
    // Standard response for smaller datasets (≤10 rows)
    const result = {
      success: true,
      data: limitedData,
      columns: columns,
      rowCount: totalRows,
      message: `Query executed successfully. Retrieved ${totalRows} rows.`
    };
    
    // Add performance warnings from validation if any
    if (validation.warnings) {
      result.warnings = validation.warnings;
      result.suggestions = validation.suggestions;
    }
    
    return result;
    
  } catch (err) {
    // Enhanced error handling with suggestions
    const errorMessage = err.message;
    const suggestions = [];
    
    if (errorMessage.includes('HTTP 400')) {
      suggestions.push({
        category: "Query Syntax",
        items: [
          "Check table names are correct (frpindx, frpair, frpsec)",
          "Verify column names exist in the table",
          "Check for typos in SQL keywords",
          "Try a simpler query first: SELECT * FROM frpindx LIMIT 5"
        ]
      });
    } else if (errorMessage.includes('timeout') || errorMessage.includes('slow')) {
      suggestions.push({
        category: "Performance",
        items: [
          "Add LIMIT clause to reduce result size",
          "Add WHERE clause to filter data",
          "Select specific columns instead of *"
        ]
      });
    } else if (errorMessage.includes('permission') || errorMessage.includes('access')) {
      suggestions.push({
        category: "Access",
        items: [
          "Check if table name is correct",
          "Try with a known table: frpindx, frpair, or frpsec",
          "Contact administrator if table should be accessible"
        ]
      });
    }
    
    const response = { 
      error: `Database error: ${errorMessage}`,
      query: query
    };
    
    if (suggestions.length > 0) {
      response.suggestions = suggestions;
    }
    
    return response;
  }
}

// Prepare SQL query for user approval
async function prepareSqlForUser(query, env = null) {
  
  try {
    // Validate that this is a modification query
    const trimmedQuery = query.trim().toUpperCase();
    if (!trimmedQuery.startsWith('UPDATE') && !trimmedQuery.startsWith('INSERT') && !trimmedQuery.startsWith('DELETE')) {
      return { error: 'This tool is only for UPDATE, INSERT, or DELETE operations. Use execute_sql for SELECT queries.' };
    }
    
    // Optional verification step - extract table name and run a quick lookup
    let verificationInfo = '';
    try {
      const db = new DatabaseManager(env?.DB || null, null, env);
      
      // Extract table name from query for verification
      const tableMatch = query.match(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(\w+)/i);
      if (tableMatch) {
        const tableName = tableMatch[1];
        
        // For UPDATE queries, try to verify the WHERE clause
        if (trimmedQuery.startsWith('UPDATE')) {
          const whereMatch = query.match(/WHERE\s+(\w+)\s*=\s*['"](.*?)['"]$/i);
          if (whereMatch) {
            const [, column, value] = whereMatch;
            const verifyQuery = `SELECT COUNT(*) as count FROM ${tableName} WHERE ${column} = '${value}'`;
            const result = await db.executeFinancialQuery(verifyQuery);
            const count = result[0]?.count || 0;
            verificationInfo = `\nVerification: Found ${count} record(s) matching WHERE condition.`;
          }
        }
        
        // For all queries, verify table structure
        const structureQuery = `SELECT * FROM ${tableName} LIMIT 1`;
        await db.executeFinancialQuery(structureQuery);
        verificationInfo += `\nTable ${tableName} verified and accessible.`;
      }
    } catch (verifyErr) {
      verificationInfo = `\nWarning: Could not verify query - ${verifyErr.message}`;
    }
    
    // Return the query for user approval without executing it
    return {
      success: true,
      requiresApproval: true,
      query: query,
      message: `Query prepared for approval. Click the button below to execute it.${verificationInfo}`,
      approvalButton: {
        text: 'Execute Query',
        query: query
      }
    };
    
  } catch (err) {
    return { error: `Error preparing query: ${err.message}` };
  }
}

// Execute user-approved SQL query
async function executeUserApprovedSql(query, env = null) {
  
  try {
    // Create database manager instance
    const db = new DatabaseManager(env?.DB || null, null, env);
    
    // Execute the approved query (financial data goes to DuckDB)
    const result = await db.executeFinancialQuery(query);
    
    
    return {
      success: true,
      message: 'Query executed successfully',
      result: result
    };
    
  } catch (err) {
    return { error: `Database error: ${err.message}` };
  }
}

// Schema tool removed - schema is now included in system prompt

// Knowledge base helper functions
function searchKnowledgeBase(searchTerm, category = null) {
  const kb = loadKnowledgeBase();
  if (!kb) return [];

  // Handle undefined or null searchTerm
  if (!searchTerm || typeof searchTerm !== 'string') {
    return [];
  }

  const searchTermLower = searchTerm.toLowerCase();
  const matches = new Set();
  const ranked = { exact: [], partial: [], content: [] };

  // 1. Search in topics - add null checks and category filtering
  if (kb.searchIndex?.topics?.[searchTermLower]) {
    kb.searchIndex.topics[searchTermLower].forEach(id => {
      if (kb.files[id] && (!category || kb.files[id].category === category)) {
        matches.add(id);
        ranked.exact.push(id);
      }
    });
  }

  // 2. Search in terms - add null checks and category filtering
  if (kb.searchIndex?.terms?.[searchTermLower]) {
    kb.searchIndex.terms[searchTermLower].forEach(id => {
      if (kb.files[id] && !matches.has(id) && (!category || kb.files[id].category === category)) {
        matches.add(id);
        ranked.exact.push(id);
      }
    });
  }

  // 3. Partial match search in file titles - medium priority
  Object.keys(kb.files).forEach(fileId => {
    const file = kb.files[fileId];
    if (file && (file.title.toLowerCase().includes(searchTermLower) || 
         file.id.toLowerCase().includes(searchTermLower)) && 
        !matches.has(fileId) && (!category || file.category === category)) {
      matches.add(fileId);
      ranked.partial.push(fileId);
    }
  });

  // 4. Regex search capability - fix regex detection
  let isRegexSearch = false;
  let regexPattern = null;
  if (searchTerm.includes('*') || searchTerm.includes('\\\\') || searchTerm.includes('[') || searchTerm.includes('^') || searchTerm.includes('$')) {
    try {
      // Convert simple wildcards to regex if needed
      let pattern = searchTerm.replace(/\*/g, '.*');
      regexPattern = new RegExp(pattern, 'i');
      isRegexSearch = true;
    } catch (e) {
      // Invalid regex, fall back to normal search
    }
  }

  // 5. Full-text content search (including regex) - lower priority
  if (matches.size === 0 || isRegexSearch) {
    Object.keys(kb.files).forEach(fileId => {
      const file = kb.files[fileId];
      if (!file || matches.has(fileId) || (category && file.category !== category)) {
        return;
      }
      
      let contentToSearch = '';
      
      if (file.contentType === 'json' && file.content?.tables) {
        // Search JSON content with null checks
        contentToSearch = file.content.tables.map(t => `${t.name || ''} ${t.description || ''}`).join(' ');
      } else if (typeof file.content === 'string') {
        contentToSearch = file.content;
      }
      
      contentToSearch = contentToSearch.toLowerCase();
      
      let found = false;
      if (isRegexSearch && regexPattern) {
        found = regexPattern.test(contentToSearch) || regexPattern.test(file.title) || regexPattern.test(file.id);
      } else {
        found = contentToSearch.includes(searchTermLower);
      }
      
      if (found) {
        matches.add(fileId);
        ranked.content.push(fileId);
      }
    });
  }

  return [...ranked.exact, ...ranked.partial, ...ranked.content];
}

function formatEntryContent(entry, truncate = false) {
  if (!entry) return '';

  let content = '';
  
  if (entry.contentType === 'json' && entry.content) {
    // Add null checks for JSON content
    if (entry.content.document?.title) {
      const version = entry.content.document.version || 'Unknown version';
      content += `**${entry.content.document.title}** (${version})\n\n`;
    }
    
    if (entry.content.tables?.length) {
      const tableCount = entry.content.tables.length;
      content += `Database reference containing ${tableCount} tables:\n\n`;
      
      const tablesToShow = truncate ? entry.content.tables.slice(0, 5) : entry.content.tables;
      tablesToShow.forEach(table => {
        const description = table.description || 'No description';
        content += `- **${table.name}**: ${description}\n`;
      });
      
      if (truncate && tableCount > 5) {
        content += `... and ${tableCount - 5} more tables`;
      }
    }
  } else {
    // Safely handle text content
    const textContent = typeof entry.content === 'string' ? entry.content : 
                       typeof entry.content === 'object' ? JSON.stringify(entry.content) : 
                       String(entry.content || '');
    
    content = textContent;
    
    if (truncate && content.length > 500) {
      content = content.substring(0, 500) + '...';
    }
  }
  
  return content;
}



// Tool factory function to create tools with environment access
export function createTools(env = null, allowedTools = null) {
  const allTools = {
    evaluate_expression: {
      description: "Evaluate a numeric arithmetic expression",
      inputSchema: z.object({
        expression: z.string().describe("Arithmetic expression to evaluate")
      }),
      execute: ({ expression }) => {
        try {
          const result = evaluate(expression);
          return { result };
        } catch (err) {
          return { error: String(err) };
        }
      }
    },
    execute_sql: {
      description: "Execute SQL SELECT queries to retrieve financial data. Use this for all data analysis requests.",
      inputSchema: z.object({
        query: z.string().describe("SQL SELECT query to execute")
      }),
      execute: async ({ query }) => {
        try {
          return await withTimeout(
            executeSqlQuery(query, env),
            AI_CONFIG.TOOL_EXECUTION.SQL_TIMEOUT,
            'execute_sql'
          );
        } catch (error) {
          if (error.message.includes('timed out')) {
            return {
              error: `SQL query timed out after ${AI_CONFIG.TOOL_EXECUTION.SQL_TIMEOUT / 1000} seconds. Try simplifying your query or adding LIMIT clause.`,
              suggestions: [
                {
                  category: "Timeout Solutions",
                  items: [
                    "Add LIMIT clause to reduce result size",
                    "Use more specific WHERE conditions",
                    "Select fewer columns instead of *",
                    "Break complex queries into simpler parts"
                  ]
                }
              ]
            };
          }
          throw error;
        }
      }
    },
    prepare_sql_for_user: {
      description: "Prepare UPDATE, INSERT, or DELETE queries for user approval. Returns query as approval button - does not execute. Use for all data modification requests.",
      inputSchema: z.object({
        query: z.string().describe("SQL query to prepare for user approval")
      }),
      execute: async ({ query }) => await prepareSqlForUser(query, env)
    },
    execute_user_approved_sql: {
      description: "Execute user-approved SQL query. Only used when user clicks approval button.",
      inputSchema: z.object({
        query: z.string().describe("User-approved SQL query to execute")
      }),
      execute: async ({ query }) => await executeUserApprovedSql(query, env)
    },
    lookup_knowledge_base: {
      description: "Search First Rate Performance knowledge base for definitions, procedures, and technical documentation. Accepts both 'query' and 'search_query' parameters. Use detailed=true for complete content. Perfect for batch_tool parallel searches.",
      inputSchema: z.object({
        query: z.string().describe("Search term or entry ID to look up").optional(),
        search_query: z.string().describe("Alternative parameter name for search term (alias for query)").optional(),
        category: z.string().describe("Optional category to filter search results").optional(),
        detailed: z.boolean().describe("Return full content (true) or summary (false). Default false.").optional()
      }),
      execute: async ({ query, search_query, category = null, detailed = false }) => {
        try {
          return await withTimeout(
            Promise.resolve().then(() => {
              // Original lookup logic wrapped in promise
              const kb = loadKnowledgeBase();
          if (!kb) {
            return { error: 'Knowledge base not available' };
          }

          // Use either query or search_query parameter
          const searchTerm = query || search_query;

          // Validate query parameter
          if (!searchTerm || typeof searchTerm !== 'string') {
            return { 
              error: 'Query parameter is required and must be a string',
              success: false 
            };
          }

          // If searchTerm looks like a direct ID, try to get it directly
          if (searchTerm && !searchTerm.includes(' ') && kb.files[searchTerm]) {
            const entry = kb.files[searchTerm];
            return {
              success: true,
              type: 'direct_lookup',
              entry: {
                id: entry.id,
                title: entry.title,
                category: entry.category,
                content: formatEntryContent(entry, !detailed)
              }
            };
          }

          // Perform search
          const matchingIds = searchKnowledgeBase(searchTerm, category);
          
          if (matchingIds.length === 0) {
            return {
              success: true,
              type: 'no_matches',
              message: `No knowledge base entries found for "${searchTerm}"${category ? ` in category "${category}"` : ''}`,
              availableCategories: kb.categories.map(cat => ({
                name: cat.name,
                displayName: cat.displayName,
                fileCount: cat.fileCount
              }))
            };
          }

          // Return search results
          const results = matchingIds.slice(0, 10).map(id => {
            const entry = kb.files[id];
            return {
              id: entry.id,
              title: entry.title,
              category: entry.category,
              content: formatEntryContent(entry, !detailed)
            };
          });

          return {
            success: true,
            type: 'search_results',
            query: searchTerm,
            category: category,
            totalMatches: matchingIds.length,
            results: results,
            message: `Found ${matchingIds.length} entries matching "${searchTerm}"${category ? ` in category "${category}"` : ''}`
          };
            }),
            AI_CONFIG.TOOL_EXECUTION.KB_TIMEOUT,
            'lookup_knowledge_base'
          );
        } catch (error) {
          if (error.message.includes('timed out')) {
            return {
              error: `Knowledge base search timed out after ${AI_CONFIG.TOOL_EXECUTION.KB_TIMEOUT / 1000} seconds. Try a more specific search term.`,
              suggestions: [
                {
                  category: "Search Optimization",
                  items: [
                    "Use more specific search terms",
                    "Try searching by exact entry ID",
                    "Browse specific categories instead",
                    "Use shorter search queries"
                  ]
                }
              ]
            };
          }
          throw error;
        }
      }
    },
    get_knowledge_base_categories: {
      description: "Get list of available knowledge base categories. Use to explore what information is available.",
      inputSchema: z.object({}),
      execute: () => {
        
        try {
          const kb = loadKnowledgeBase();
          if (!kb) {
            return { error: 'Knowledge base not available' };
          }

          const categories = kb.categories.map(cat => ({
            name: cat.name,
            displayName: cat.displayName,
            fileCount: cat.fileCount
          }));

          return {
            success: true,
            categories: categories,
            message: `Available knowledge base categories: ${categories.map(c => c.displayName).join(', ')}`
          };
        } catch (error) {
          console.error('Knowledge base categories error:', error);
          return { error: `Failed to get categories: ${error.message}` };
        }
      }
    },
    browse_knowledge_base_category: {
      description: "Browse all entries in a specific knowledge base category. Use get_knowledge_base_categories first to see options.",
      inputSchema: z.object({
        category: z.string().describe("Category to browse")
      }),
      execute: ({ category }) => {
        
        try {
          const kb = loadKnowledgeBase();
          if (!kb) {
            return { error: 'Knowledge base not available' };
          }

          // More precise category matching
          const categoryData = kb.categories.find(cat => 
            cat.name === category || 
            cat.name.toLowerCase() === category.toLowerCase() ||
            cat.displayName.toLowerCase() === category.toLowerCase()
          );
          
          if (!categoryData) {
            return {
              success: true,
              type: 'no_entries',
              message: `No entries found in category "${category}"`,
              availableCategories: kb.categories.map(cat => ({
                name: cat.name,
                displayName: cat.displayName,
                fileCount: cat.fileCount
              }))
            };
          }

          // Add null checks for file access
          const results = categoryData.files
            .filter(fileId => kb.files[fileId]) // Filter out missing files
            .map(fileId => {
              const entry = kb.files[fileId];
              return {
                id: entry.id,
                title: entry.title,
                category: entry.category,
                content: formatEntryContent(entry, true) // Always truncate for browsing
              };
            });

          return {
            success: true,
            type: 'category_browse',
            category: category,
            totalEntries: results.length,
            results: results,
            message: `Found ${results.length} entries in category "${categoryData.displayName}"`
          };

        } catch (error) {
          console.error('Knowledge base category browse error:', error);
          return { error: `Failed to browse category: ${error.message}` };
        }
      }
    },

    // Agent control tools
    continue_agent: {
      description: "Continue analysis with additional tools when initial results are incomplete. Use sparingly - prefer batch_tool first. Examples: when initial searches find references to other terms needing lookup, when data analysis reveals need for additional queries. Don't use if you can answer the question with current results.",
      inputSchema: z.object({
        reason: z.string().describe("Why you want to continue analyzing (helps with context)")
      }),
      execute: ({ reason }) => {
        return {
          success: true,
          action: 'continue',
          reason: reason,
          message: 'Continuing analysis to provide more comprehensive insights'
        };
      }
    },

    complete_task: {
      description: "OPTIONAL: Formally signal analysis completion with structured response. Not required - you can provide final answers directly in your response. Use for complex multi-step analysis when you want to clearly separate your methodology from final conclusions. Prefer direct answers over this tool for simple questions.",
      inputSchema: z.object({
        response: z.string().describe("Your complete answer to the user's question with all the details you found"),
        summary: z.string().describe("Brief summary of what was accomplished"),
        recommendations: z.string().describe("Any recommendations or next steps").optional()
      }),
      execute: ({ response, summary, recommendations }) => {
        return {
          success: true,
          action: 'complete',
          response: response,
          summary: summary,
          recommendations: recommendations,
          message: 'Analysis completed successfully'
        };
      }
    },

    batch_tool: {
      description: "Execute multiple tool calls simultaneously in parallel for maximum efficiency. STRONGLY RECOMMENDED for first-turn data gathering. Examples: parallel knowledge base searches, combining SQL queries with documentation lookups. Use whenever you need 2+ tools rather than sequential calls. Saves iterations and provides faster results.",
      inputSchema: z.object({
        invocations: z.array(z.object({
          name: z.string().describe("The name of the tool to invoke"),  
          arguments: z.record(z.string(), z.any()).describe("The arguments to pass to the tool")
        })).describe("Array of tool invocations to execute in parallel")
      }),
      execute: async ({ invocations }) => {
        // Create promises for all tool executions
        const batchPromises = invocations.map(async (invocation, index) => {
          const { name, arguments: args } = invocation;
          
          // Prevent recursive batch calls
          if (name === 'batch_tool') {
            return {
              tool_name: name,
              arguments: args,
              error: 'Recursive batch tool calls are not allowed',
              success: false,
              index
            };
          }
          
          if (!allTools[name]) {
            return {
              tool_name: name,
              arguments: args,
              error: `Tool ${name} not found`,
              success: false,
              index
            };
          }
          
          try {
            // Determine timeout based on tool type
            let timeout = AI_CONFIG.TOOL_EXECUTION.DEFAULT_TIMEOUT;
            if (name === 'execute_sql' || name === 'prepare_sql_for_user') {
              timeout = AI_CONFIG.TOOL_EXECUTION.SQL_TIMEOUT;
            } else if (name.includes('knowledge_base')) {
              timeout = AI_CONFIG.TOOL_EXECUTION.KB_TIMEOUT;
            }
            
            // Execute with timeout
            const toolOutput = await withTimeout(
              allTools[name].execute(args),
              timeout,
              name
            );
            
            return {
              tool_name: name,
              arguments: args,
              ...toolOutput,
              index
            };
          } catch (error) {
            const isTimeout = error.message.includes('timed out');
            return {
              tool_name: name,
              arguments: args,
              error: error.message,
              success: false,
              timeout: isTimeout,
              index
            };
          }
        });
        
        // Execute all promises in parallel with batch timeout
        let batchResults;
        try {
          batchResults = await withTimeout(
            Promise.all(batchPromises),
            AI_CONFIG.TOOL_EXECUTION.BATCH_TIMEOUT,
            'batch_tool'
          );
        } catch (error) {
          return {
            success: false,
            error: error.message,
            batch_results: [],
            total_invocations: invocations.length,
            successful_invocations: 0,
            message: 'Batch execution failed due to timeout'
          };
        }
        
        // Sort results by original order and calculate stats
        const batchOutput = batchResults.sort((a, b) => a.index - b.index);
        const successful = batchOutput.filter(r => r.success !== false).length;
        const timedOut = batchOutput.filter(r => r.timeout).length;
        
        const result = {
          success: true,
          batch_results: batchOutput.map(({ index, ...rest }) => rest), // Remove index from output
          total_invocations: invocations.length,
          successful_invocations: successful,
          message: `Batch execution completed: ${successful}/${invocations.length} tools executed successfully`
        };
        
        // Add additional info for partial failures
        if (successful < invocations.length) {
          result.partial_failure = true;
          if (timedOut > 0) {
            result.message += ` (${timedOut} timed out)`;
          }
        }
        
        return result;
      }
    }
  };

  // Filter tools if allowedTools is specified
  if (allowedTools && Array.isArray(allowedTools)) {
    const filteredTools = {};
    allowedTools.forEach(toolName => {
      if (allTools[toolName]) {
        filteredTools[toolName] = allTools[toolName];
      }
    });
    return filteredTools;
  }
  
  return allTools;
}

// Legacy export for backward compatibility
export const tools = createTools();