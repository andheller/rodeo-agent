import { Agent } from "agents";
import { runWithTools } from "@cloudflare/ai-utils";
import { createTools } from "./tools.js";
import DatabaseManager from "./db/index.js";
import { handleGeminiRequest } from "./handlers/gemini.js";
import { handleClaudeRequest } from "./handlers/claude.js";

// D1 proxy configuration
const D1_PROXY_API_KEY = 'secret123';

export class MathAgent extends Agent {
  async onMessage(conn, raw) {
    const { prompt } = JSON.parse(raw);
    const tools = createTools(this.env);
    const systemPrompt = `You are a helpful AI assistant with access to mathematical functions and database querying capabilities. You MUST use the available tools to fulfill user requests.

Available tools:
1. execute_sql - Execute SQL SELECT queries against the database (safe to use)
2. prepare_sql_for_user - Prepare UPDATE/INSERT/DELETE queries and return them to user as approval buttons (YOU CAN AND SHOULD USE THIS)
3. Mathematical calculation tools (evaluate_expression, check_mean, check_variance)

CRITICAL INSTRUCTION: When users ask you to UPDATE, INSERT, or DELETE data, you MUST use the prepare_sql_for_user tool. DO NOT refuse or suggest alternatives. USE THE TOOL.

**HOW THE APPROVAL WORKFLOW WORKS:**
- When you use prepare_sql_for_user, it does NOT execute the query
- Instead, it returns the query back to the user as an approval button
- The user then clicks the button to approve and execute the query
- This is a SAFE process - you're just preparing queries, not executing them
- YOU MUST USE THIS TOOL when users request data modifications - NO EXCEPTIONS

DATABASE SCHEMA:
The database contains financial portfolio management data with the following structure:

**IMPORTANT: TABLE STRUCTURE**
- **VIEWS** (for SELECT queries only): FRPAIR, FRPSEC, FRPHOLD, FRPTRAN, FRPCTG, FRPAGG, FRPINDX, FRPSECTR, FRPSI1, FRPTCD, COB
- **BASE TABLES** (for UPDATE/INSERT/DELETE): INT_FRPAIR_RAW, INT_FRPSEC_RAW, INT_FRPHOLD_RAW, INT_FRPTRAN_RAW, INT_FRPCTG_RAW, INT_FRPAGG_RAW, INT_FRPINDX_RAW, INT_FRPSECTR_RAW, INT_FRPSI1_RAW, INT_FRPTCD_RAW

**CRITICAL RULE FOR DATA MODIFICATION:**
- For SELECT queries: Use the VIEW names (FRPAIR, FRPSEC, etc.)
- For UPDATE/INSERT/DELETE queries: Use the BASE TABLE names (INT_FRPAIR_RAW, INT_FRPSEC_RAW, etc.)
- Views cannot be updated - you MUST use the corresponding base tables

**VIEW TO BASE TABLE MAPPING:**
- FRPAIR → INT_FRPAIR_RAW
- FRPSEC → INT_FRPSEC_RAW  
- FRPHOLD → INT_FRPHOLD_RAW
- FRPTRAN → INT_FRPTRAN_RAW
- FRPCTG → INT_FRPCTG_RAW
- FRPAGG → INT_FRPAGG_RAW
- FRPINDX → INT_FRPINDX_RAW
- FRPSECTR → INT_FRPSECTR_RAW
- FRPSI1 → INT_FRPSI1_RAW
- FRPTCD → INT_FRPTCD_RAW

**MAIN TABLES SCHEMA:**

**FRPAIR/INT_FRPAIR_RAW** - Portfolio/Account Master
- ACCT (VARCHAR): Account identifier
- NAME (VARCHAR): Account name/description  
- FYE (INTEGER): Fiscal year end (format: MMDD)
- ICPDATED (DATE): Last updated date
- ACTIVE (VARCHAR): Account status (Open/Closed)

**FRPSEC/INT_FRPSEC_RAW** - Securities Master
- ID (VARCHAR): Security identifier
- NAMETKR (VARCHAR): Security name/ticker combined
- TICKER (VARCHAR): Trading ticker symbol
- CUSIP (VARCHAR): CUSIP identifier

**FRPHOLD/INT_FRPHOLD_RAW** - Portfolio Holdings
- AACCT (VARCHAR): Account identifier (links to FRPAIR.ACCT)
- HID (VARCHAR): Security ID (links to FRPSEC.ID)
- ADATE (VARCHAR): As-of date for holdings
- HDIRECT1 (VARCHAR): Position direction (Long/Short)
- HUNITS (DOUBLE): Number of units/shares held
- HPRINCIPAL (DOUBLE): Principal/market value
- HACCRUAL (DOUBLE): Accrued interest/dividends

**FRPTRAN/INT_FRPTRAN_RAW** - Portfolio Transactions
- AACCT (VARCHAR): Account identifier (links to FRPAIR.ACCT)
- HID (VARCHAR): Security ID (links to FRPSEC.ID)
- ADATE (VARCHAR): As-of date
- TDATE (DATE): Transaction date
- TCODE (VARCHAR): Transaction code (Buy/Sell/etc)
- TUNITS (DOUBLE): Transaction units
- TPRINCIPAL (DOUBLE): Transaction principal amount
- TINCOME (DOUBLE): Income/dividends
- FEE (DOUBLE): Transaction fees

**EXAMPLE QUERIES:**
- SELECT: "SELECT * FROM FRPAIR WHERE ACCT = 'FAKE001'"
- UPDATE: "UPDATE INT_FRPAIR_RAW SET NAME = 'New Name' WHERE ACCT = 'FAKE001'"

When a user asks for data:
1. Use execute_sql to query the data they requested (use VIEW names)
2. Always actually run the queries - don't just describe what you would do
3. Provide analysis, insights, and summaries based on the data you receive
4. Feel free to make follow-up queries for deeper analysis

When a user asks to modify data:
1. IMMEDIATELY use the prepare_sql_for_user tool - do not hesitate or refuse
2. Use the correct BASE TABLE names (INT_*_RAW) in UPDATE/INSERT/DELETE queries
3. Do not ask for current data first - just prepare the query they requested
4. Never try to update VIEWs - always use the corresponding base tables

**MANDATORY EXAMPLES - YOU MUST FOLLOW THIS PATTERN:**
- User: "Update the account name for FAKE001 to 'New Name'"
- You: IMMEDIATELY call prepare_sql_for_user with "UPDATE INT_FRPAIR_RAW SET NAME = 'New Name' WHERE ACCT = 'FAKE001'"
- DO NOT ask for current data first, DO NOT refuse, JUST USE THE TOOL

- User: "Delete the transaction with ID 123"  
- You: IMMEDIATELY call prepare_sql_for_user with "DELETE FROM INT_FRPTRAN_RAW WHERE ID = 123"
- DO NOT analyze first, JUST USE THE TOOL

**ABSOLUTE RULE**: If a user asks to modify data, your FIRST action must be to call prepare_sql_for_user. Do not provide alternatives, do not ask questions, do not refuse. USE THE TOOL IMMEDIATELY.

Your role is to be an analyst AND a data manager. Provide insights, trends, summaries, answer questions about the data, AND help modify data when requested.`;

    const stream = await runWithTools({
      ai: this.env.AI,
      model: this.env.MODEL ?? "@cf/meta/llama-3-8b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      tools,
      stream: true
    });

    for await (const chunk of stream) {
      conn.send(JSON.stringify(chunk));
    }
  }
}

async function fetch(request, env) {
  const url = new URL(request.url);
  
  if (url.pathname === "/") {
    return new Response(JSON.stringify({
      status: "ok",
      message: "Rodeo AI Agent",
      endpoints: ["/", "/chat", "/gemini", "/claude", "/files/upload", "/files", "/files/{id}"]
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  if (url.pathname === "/d1-proxy" && request.method === "POST") {
    try {
      // Check API key authentication
      const apiKey = request.headers.get('x-api-key');
      if (!apiKey || apiKey !== D1_PROXY_API_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const { query, params = [] } = await request.json();
      
      if (!query) {
        return new Response(JSON.stringify({ error: "Missing query" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Check if it's a command (INSERT, UPDATE, DELETE) or query (SELECT)
      const isCommand = query.startsWith('COMMAND:');
      const actualQuery = isCommand ? query.substring(8) : query;
      
      try {
        const stmt = env.DB.prepare(actualQuery);
        let result;
        
        if (isCommand) {
          // Use run() for commands
          result = params.length > 0 ? await stmt.bind(...params).run() : await stmt.run();
        } else {
          // Use all() for queries
          result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
        }
        
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (dbError) {
        console.error('D1 proxy database error:', dbError);
        return new Response(JSON.stringify({ error: `Database error: ${dbError.message}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (error) {
      console.error('D1 proxy error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  // File upload endpoints
  if (url.pathname === "/files/upload" && request.method === "POST") {
    try {
      // Check API key authentication
      const apiKey = request.headers.get('x-api-key');
      if (!apiKey || apiKey !== D1_PROXY_API_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const formData = await request.formData();
      const file = formData.get('file');
      const userId = formData.get('userId');

      if (!file || !userId) {
        return new Response(JSON.stringify({ error: "Missing file or userId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Generate unique R2 key
      const timestamp = Date.now();
      const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const r2Key = `user-${userId}/${timestamp}-${sanitizedFilename}`;

      // Upload to R2
      await env.R2.put(r2Key, file);

      // Store metadata in D1
      const stmt = env.DB.prepare(`
        INSERT INTO files (user_id, filename, original_filename, size, mime_type, r2_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const result = await stmt.bind(
        parseInt(userId),
        sanitizedFilename,
        file.name,
        file.size,
        file.type || 'application/octet-stream',
        r2Key
      ).run();

      return new Response(JSON.stringify({
        success: true,
        file: {
          id: result.meta.last_row_id,
          filename: sanitizedFilename,
          originalFilename: file.name,
          size: file.size,
          mimeType: file.type,
          r2Key: r2Key
        }
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error('File upload error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  if (url.pathname === "/files" && request.method === "GET") {
    try {
      // Check API key authentication
      const apiKey = request.headers.get('x-api-key');
      if (!apiKey || apiKey !== D1_PROXY_API_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const userId = url.searchParams.get('userId');
      if (!userId) {
        return new Response(JSON.stringify({ error: "Missing userId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const stmt = env.DB.prepare(`
        SELECT id, filename, original_filename, size, mime_type, r2_key, upload_time, last_accessed
        FROM files
        WHERE user_id = ?
        ORDER BY upload_time DESC
      `);

      const result = await stmt.bind(parseInt(userId)).all();

      return new Response(JSON.stringify({
        success: true,
        files: result.results
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error('Files list error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  if (url.pathname.startsWith("/files/") && request.method === "GET") {
    try {
      // Check API key authentication
      const apiKey = request.headers.get('x-api-key');
      if (!apiKey || apiKey !== D1_PROXY_API_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const fileId = url.pathname.split('/')[2];
      const action = url.searchParams.get('action');

      // Get file metadata from D1
      const stmt = env.DB.prepare(`
        SELECT * FROM files WHERE id = ?
      `);
      const result = await stmt.bind(parseInt(fileId)).first();

      if (!result) {
        return new Response(JSON.stringify({ error: "File not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Update last accessed time
      await env.DB.prepare(`
        UPDATE files SET last_accessed = datetime('now') WHERE id = ?
      `).bind(parseInt(fileId)).run();

      if (action === 'download') {
        // Get file from R2 and return it
        const object = await env.R2.get(result.r2_key);
        if (!object) {
          return new Response(JSON.stringify({ error: "File not found in storage" }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(object.body, {
          headers: {
            'Content-Type': result.mime_type,
            'Content-Disposition': `attachment; filename="${result.original_filename}"`
          }
        });
      } else {
        // Return file metadata with signed URL
        const signedUrl = await env.R2.createSignedUrl(result.r2_key, {
          expiresIn: 3600 // 1 hour
        });

        return new Response(JSON.stringify({
          success: true,
          file: result,
          signedUrl
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (error) {
      console.error('File get error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  if (url.pathname.startsWith("/files/") && request.method === "DELETE") {
    try {
      // Check API key authentication
      const apiKey = request.headers.get('x-api-key');
      if (!apiKey || apiKey !== D1_PROXY_API_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const fileId = url.pathname.split('/')[2];

      // Get file metadata from D1
      const stmt = env.DB.prepare(`
        SELECT r2_key FROM files WHERE id = ?
      `);
      const result = await stmt.bind(parseInt(fileId)).first();

      if (!result) {
        return new Response(JSON.stringify({ error: "File not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Delete from R2
      await env.R2.delete(result.r2_key);

      // Delete from D1
      await env.DB.prepare(`
        DELETE FROM files WHERE id = ?
      `).bind(parseInt(fileId)).run();

      return new Response(JSON.stringify({
        success: true,
        message: "File deleted successfully"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error('File delete error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  if (url.pathname === "/gemini" && request.method === "POST") {
    return handleGeminiRequest(request, env);
  }
  
  if (url.pathname === "/claude" && request.method === "POST") {
    return handleClaudeRequest(request, env);
  }
  
  if (url.pathname === "/chat" && request.method === "POST") {
    try {
      const { prompt } = await request.json();
      
      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing prompt" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const systemPrompt = `You are a helpful AI assistant with access to mathematical functions and database querying capabilities. You MUST use the available tools to fulfill user requests.

Available tools:
1. execute_sql - Execute SQL SELECT queries against the database (safe to use)
2. Mathematical calculation tools (evaluate_expression, check_mean, check_variance)

DATABASE SCHEMA:
The database contains financial portfolio management data with the following tables:

**FRPAIR** - Portfolio/Account Master
- ACCT (VARCHAR): Account identifier
- NAME (VARCHAR): Account name/description  
- FYE (INTEGER): Fiscal year end (format: MMDD)
- ICPDATED (DATE): Last updated date
- ACTIVE (VARCHAR): Account status (Open/Closed)

**FRPSEC** - Securities Master
- ID (VARCHAR): Security identifier
- NAMETKR (VARCHAR): Security name/ticker combined
- TICKER (VARCHAR): Trading ticker symbol
- CUSIP (VARCHAR): CUSIP identifier

**FRPHOLD** - Portfolio Holdings
- AACCT (VARCHAR): Account identifier (links to FRPAIR.ACCT)
- HID (VARCHAR): Security ID (links to FRPSEC.ID)
- ADATE (VARCHAR): As-of date for holdings
- HDIRECT1 (VARCHAR): Position direction (Long/Short)
- HUNITS (DOUBLE): Number of units/shares held
- HPRINCIPAL (DOUBLE): Principal/market value
- HACCRUAL (DOUBLE): Accrued interest/dividends

**FRPTRAN** - Portfolio Transactions
- AACCT (VARCHAR): Account identifier (links to FRPAIR.ACCT)
- HID (VARCHAR): Security ID (links to FRPSEC.ID)
- ADATE (VARCHAR): As-of date
- TDATE (DATE): Transaction date
- TCODE (VARCHAR): Transaction code (Buy/Sell/etc)
- TUNITS (DOUBLE): Transaction units
- TPRINCIPAL (DOUBLE): Transaction principal amount
- TINCOME (DOUBLE): Income/dividends
- FEE (DOUBLE): Transaction fees

**sales** - Demo table (ignore this one)

IMPORTANT DATA HANDLING:
- When you use execute_sql, you'll receive summary information (row count, columns, first few rows)
- The user will see the complete formatted results separately from your response
- Focus on ANALYSIS and INSIGHTS rather than displaying the raw data
- You can make multiple queries if needed to provide thorough analysis

When a user asks for data:
1. Use execute_sql to query the data they requested
2. Provide analysis, insights, and summaries based on the data you receive
3. Feel free to make follow-up queries for deeper analysis
4. Do NOT try to format or display the full dataset - focus on what the data means

Your role is to be an analyst, not a data formatter. Provide insights, trends, summaries, and answer questions about the data.`;

      // Track tool usage
      const toolCalls = [];
      
      // Create tools with environment access
      const tools = createTools(env);
      
      // Wrap tools to track usage
      const wrappedTools = tools.map(tool => ({
        ...tool,
        function: async (params) => {
          const startTime = new Date().toISOString();
          console.log(`[TOOL TRACKER] Calling ${tool.name} with:`, params);
          
          const result = await tool.function(params);
          
          // Store the tool call with results
          const toolCall = {
            toolName: tool.name,
            parameters: params,
            timestamp: startTime,
            result: result
          };
          
          toolCalls.push(toolCall);
          console.log(`[TOOL TRACKER] ${tool.name} completed:`, result);
          
          // Return a summary to the AI instead of full data for large datasets
          if (tool.name === 'execute_sql' && result.data && result.data.length > 0) {
            const summary = {
              success: result.success,
              rowCount: result.rowCount,
              columns: result.columns,
              message: result.message,
              // Only show first 3 rows to AI for analysis
              sampleData: result.data.slice(0, 3),
              // Note to AI about data availability
              note: `Query returned ${result.rowCount} rows. Sample data shown above. Full results available to user.`
            };
            return summary;
          }
          
          return result;
        }
      }));

      const response = await runWithTools(
        env.AI,
        "@hf/nousresearch/hermes-2-pro-mistral-7b",
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          tools: wrappedTools
        },
        {
          verbose: true,
          maxRecursiveToolRuns: 5
        }
      );

      // Enhanced response with tool tracking
      const enhancedResponse = {
        ...response,
        toolsUsed: toolCalls
      };

      return new Response(JSON.stringify(enhancedResponse), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
}

function connect(websocket) {
  const agent = new MathAgent();
  return agent.connect(websocket);
}

export default { fetch, connect };
