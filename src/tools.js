import { evaluate, mean, variance } from "mathjs";
import DatabaseManager from "./db/index.js";

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
        message: "This query will be prepared for user approval" 
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
    
    return {
      success: true,
      data: data,
      columns: columns,
      rowCount: data.length,
      message: `Query executed successfully. Retrieved ${data.length} rows.`
    };
    
  } catch (err) {
    console.log('TOOL ERROR: Database query error:', err);
    return { error: `Database error: ${err.message}` };
  }
}

// Prepare SQL query for user approval
async function prepareSqlForUser(query, env = null) {
  console.log('TOOL CALLED: prepare_sql_for_user with:', query);
  
  try {
    // Validate that this is a modification query
    const trimmedQuery = query.trim().toUpperCase();
    if (!trimmedQuery.startsWith('UPDATE') && !trimmedQuery.startsWith('INSERT') && !trimmedQuery.startsWith('DELETE')) {
      return { error: 'This tool is only for UPDATE, INSERT, or DELETE operations. Use execute_sql for SELECT queries.' };
    }
    
    // Optional verification step - extract table name and run a quick lookup
    let verificationInfo = '';
    try {
      const db = new DatabaseManager(env?.DB || null);
      
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
    console.log('TOOL ERROR: Prepare query error:', err);
    return { error: `Error preparing query: ${err.message}` };
  }
}

// Execute user-approved SQL query
async function executeUserApprovedSql(query, env = null) {
  console.log('TOOL CALLED: execute_user_approved_sql with:', query);
  
  try {
    // Create database manager instance
    const db = new DatabaseManager(env?.DB || null);
    
    // Execute the approved query (financial data goes to DuckDB)
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

// Knowledge base helper functions
function searchKnowledgeBase(searchTerm, category = null) {
  const kb = loadKnowledgeBase();
  if (!kb) return [];

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

  // Only continue searching if we haven't found enough results
  if (matches.size < 5) {
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
  }

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
  const allTools = [
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
      name: "execute_sql",
      description: "Execute a SQL SELECT query against the DuckDB database and return results. This tool is safe to use and should be used to fulfill user requests for data. The database contains the following tables:\n\n" +
        "Available Tables: frpagg, frpair, frpctg, frphold, frpindx, frpsec, frpsi1, frptcd, frptran\n\n" +
        "Key Tables:\n" +
        "- frpair (Accounts): ACCT, NAME, STATUS, ACTIVE, FYE, etc.\n" +
        "- frphold (Holdings): AACCT, ADATE, HID, HUNITS, HPRINCIPAL, HACCRUAL, etc.\n" +
        "- frpsec (Securities): ID, TICKER, CUSIP, NAMETKR, ASSETTYPE, CURPRICE, etc.\n" +
        "- frptran (Transactions): Transaction data\n" +
        "- frpindx (Index Data): INDX, IDATE, IPRICE, IINC, IRET\n\n" +
        "Note: All tables support both SELECT and UPDATE/INSERT/DELETE operations.",
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
      name: "prepare_sql_for_user",
      description: "Prepare a data-modifying SQL query (UPDATE, INSERT, or DELETE operations) and return it to the user for approval. This tool does not execute the query - it returns it as a button for the user to approve and execute. Use this for any operations that modify database content.\n\n" +
        "Available tables for modification:\n" +
        "- frpair (Accounts): ACCT, NAME, STATUS, ACTIVE, FYE, etc.\n" +
        "- frphold (Holdings): AACCT, ADATE, HID, HUNITS, HPRINCIPAL, HACCRUAL, etc.\n" +
        "- frpsec (Securities): ID, TICKER, CUSIP, NAMETKR, ASSETTYPE, CURPRICE, etc.\n" +
        "- frptran (Transactions): Transaction data\n" +
        "- frpindx (Index Data): INDX, IDATE, IPRICE, IINC, IRET\n" +
        "- frpagg, frpctg, frpsi1, frptcd (Additional financial data tables)\n\n" +
        "Important: Use single quotes for string literals (e.g., 'FAKE013', 'Account Name'), not double quotes.",
      parameters: {
        type: "object",
        properties: { 
          query: { 
            type: "string", 
            description: "The SQL query to prepare for user approval (e.g., 'UPDATE INT_FRPAIR_RAW SET NAME = \"New Name\" WHERE ACCT = \"123\"')" 
          } 
        },
        required: ["query"]
      },
      function: async ({ query }) => await prepareSqlForUser(query, env)
    },
    {
      name: "execute_user_approved_sql",
      description: "Execute a SQL query that has been approved by the user. This is only used when the user has clicked the approval button.",
      parameters: {
        type: "object",
        properties: { 
          query: { 
            type: "string", 
            description: "The user-approved SQL query to execute" 
          } 
        },
        required: ["query"]
      },
      function: async ({ query }) => await executeUserApprovedSql(query, env)
    },
    {
      name: "lookup_knowledge_base",
      description: "Search and retrieve information from the First Rate Performance knowledge base. Use this tool to find definitions, procedures, technical details, and documentation about the First Rate system. Supports exact term matching, partial text search, regex patterns (using * wildcards or regex syntax), and full-text content search as fallback.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term or specific entry ID to look up (e.g., 'benchmark', 'performance calculation', 'FRPAIR')"
          },
          category: {
            type: "string",
            description: "Optional category to filter search results (e.g., 'terminology', 'performance', 'data_management')"
          },
          detailed: {
            type: "boolean",
            description: "Whether to return full detailed content (true) or truncated summaries (false). Default is false."
          }
        },
        required: ["query"]
      },
      function: ({ query, category = null, detailed = false }) => {
        console.log('TOOL CALLED: lookup_knowledge_base with:', { query, category, detailed });
        
        try {
          const kb = loadKnowledgeBase();
          if (!kb) {
            return { error: 'Knowledge base not available' };
          }

          // If query looks like a direct ID, try to get it directly
          if (query && !query.includes(' ') && kb.files[query]) {
            const entry = kb.files[query];
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
          const matchingIds = searchKnowledgeBase(query, category);
          
          if (matchingIds.length === 0) {
            return {
              success: true,
              type: 'no_matches',
              message: `No knowledge base entries found for "${query}"${category ? ` in category "${category}"` : ''}`,
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
            query: query,
            category: category,
            totalMatches: matchingIds.length,
            results: results,
            message: `Found ${matchingIds.length} entries matching "${query}"${category ? ` in category "${category}"` : ''}`
          };

        } catch (error) {
          console.error('Knowledge base lookup error:', error);
          return { error: `Knowledge base lookup failed: ${error.message}` };
        }
      }
    },
    {
      name: "get_knowledge_base_categories",
      description: "Get a list of all available knowledge base categories with their file counts. Use this to understand what types of information are available in the knowledge base.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      },
      function: () => {
        console.log('TOOL CALLED: get_knowledge_base_categories');
        
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
    {
      name: "browse_knowledge_base_category",
      description: "Browse all entries in a specific knowledge base category. Matches category names exactly or by display name. Use get_knowledge_base_categories first to see available options.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "The category to browse (e.g., 'terminology', 'performance', 'data_management')"
          }
        },
        required: ["category"]
      },
      function: ({ category }) => {
        console.log('TOOL CALLED: browse_knowledge_base_category with:', { category });
        
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
    }
  ];

  // Filter tools if allowedTools is specified
  if (allowedTools && Array.isArray(allowedTools)) {
    return allTools.filter(tool => allowedTools.includes(tool.name));
  }
  
  return allTools;
}

// Legacy export for backward compatibility
export const tools = createTools();