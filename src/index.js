import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools } from "./tools.js";
import DatabaseManager from "./db/index.js";
import { handleGeminiRequest } from "./handlers/gemini.js";
import { handleClaudeRequest } from "./handlers/claude.js";
import { handleGroqRequest } from "./handlers/groq.js";

// D1 proxy configuration
const D1_PROXY_API_KEY = 'secret123';

// Helper function to get model based on provider choice
function getModel(env, provider = null) {
  const chosenProvider = provider || env.AI_PROVIDER || 'groq';
  
  switch (chosenProvider.toLowerCase()) {
    case 'anthropic':
    case 'claude':
      return anthropic(env.CLAUDE_MODEL ?? "claude-3-5-haiku-20241022");
    case 'groq':
      return groq(env.GROQ_MODEL ?? 'llama-3.3-70b-versatile');
    case 'openai':
      return openai(env.OPENAI_MODEL ?? 'gpt-4o-mini');
    default:
      return groq(env.GROQ_MODEL ?? 'llama-3.3-70b-versatile');
  }
}

// Helper functions for conversation management
async function createOrGetConversation(env, conversationId, userId, provider) {
  if (conversationId) {
    // Check if conversation exists
    const stmt = env.DB.prepare('SELECT * FROM conversations WHERE id = ?');
    const existing = await stmt.bind(conversationId).first();
    if (existing) {
      return conversationId;
    }
  }
  
  // Create new conversation
  const newId = conversationId || crypto.randomUUID();
  const stmt = env.DB.prepare(`
    INSERT INTO conversations (id, user_id, model, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
  `);
  await stmt.bind(newId, userId, provider || 'groq').run();
  return newId;
}

async function saveMessage(env, conversationId, role, content, toolCalls = null) {
  const stmt = env.DB.prepare(`
    INSERT INTO conversation_messages (conversation_id, role, content, tool_calls, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  await stmt.bind(
    conversationId,
    role,
    content,
    toolCalls ? JSON.stringify(toolCalls) : null
  ).run();
}

async function fetch(request, env) {
  const url = new URL(request.url);
  
  if (url.pathname === "/") {
    return new Response(JSON.stringify({
      status: "ok",
      message: "Rodeo AI Agent",
      endpoints: ["/", "/chat", "/stream", "/gemini", "/claude", "/groq", "/files/upload", "/files", "/files/{id}", "/conversations", "/conversations/{id}"],
      providers: ["groq", "anthropic", "openai"]
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // SSE Streaming endpoint - replaces WebSocket functionality
  if (url.pathname === "/stream" && request.method === "POST") {
    try {
      const { prompt, provider } = await request.json();
      
      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing prompt" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const tools = createTools(env);
      const systemPrompt = `You are a financial data analyst agent that can execute SQL queries against financial databases and prepares data modifications for user approval. You can lookup terms in knowledge base as needed and use math tools as needed.

Available tools:
1. execute_sql - Execute SQL SELECT queries against the database (safe to use)
2. prepare_sql_for_user - Prepare UPDATE/INSERT/DELETE queries and return them to user as approval buttons
3. lookup_knowledge_base - Search First Rate Performance knowledge base for definitions and procedures
4. Mathematical calculation tools (evaluate_expression)

Your role is to be an analyst and data manager. Provide insights, trends, summaries, and answer questions about the data.`;

      const result = await streamText({
        model: getModel(env, provider),
        system: systemPrompt,
        messages: [
          { role: "user", content: prompt }
        ],
        tools,
        maxSteps: 5
      });

      // Create SSE response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          // Send text chunks
          for await (const textDelta of result.textStream) {
            const data = `data: ${JSON.stringify({ type: 'text', content: textDelta })}\n\n`;
            controller.enqueue(encoder.encode(data));
          }

          // Send tool results
          for await (const toolResult of result.toolResults) {
            const data = `data: ${JSON.stringify({ 
              type: 'tool_result', 
              toolName: toolResult.toolName,
              result: toolResult.result 
            })}\n\n`;
            controller.enqueue(encoder.encode(data));
          }

          // Send end signal
          const endData = `data: ${JSON.stringify({ type: 'done' })}\n\n`;
          controller.enqueue(encoder.encode(endData));
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
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
  
  if (url.pathname === "/groq" && request.method === "POST") {
    return handleGroqRequest(request, env);
  }
  
  if (url.pathname === "/api/groq" && request.method === "POST") {
    return handleGroqRequest(request, env);
  }
  
  if (url.pathname === "/chat" && request.method === "POST") {
    try {
      const { prompt, provider, conversationId, userId = 1 } = await request.json();
      
      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing prompt" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const systemPrompt = `You are a helpful AI assistant with access to mathematical functions and database querying capabilities. You MUST use the available tools to fulfill user requests.

Available tools:
1. execute_sql - Execute SQL SELECT queries against the database (safe to use)
2. prepare_sql_for_user - Prepare UPDATE/INSERT/DELETE queries and return them to user as approval buttons
3. lookup_knowledge_base - Search First Rate Performance knowledge base for definitions and procedures
4. Mathematical calculation tools (evaluate_expression)

DATABASE SCHEMA:
The database contains financial portfolio management data stored in DuckDB with the following tables:

**Available Tables:**
frpagg, frpair, frpctg, frphold, frpindx, frpsec, frpsi1, frptcd, frptran

**Key Tables:**
**frpair** - Portfolio/Account Master
- ACCT (VARCHAR): Account identifier
- NAME (VARCHAR): Account name/description  
- STATUS (VARCHAR): Account status
- ACTIVE (VARCHAR): Account active status
- FYE (VARCHAR): Fiscal year end

**frpsec** - Securities Master
- ID (VARCHAR): Security identifier
- TICKER (VARCHAR): Trading ticker symbol
- CUSIP (VARCHAR): CUSIP identifier
- NAMETKR (VARCHAR): Security name/ticker combined
- ASSETTYPE (VARCHAR): Asset type
- CURPRICE (VARCHAR): Current price

**frphold** - Portfolio Holdings
- AACCT (VARCHAR): Account identifier
- ADATE (VARCHAR): As-of date for holdings
- HID (VARCHAR): Security/holding ID
- HUNITS (VARCHAR): Number of units/shares held
- HPRINCIPAL (VARCHAR): Principal/market value
- HACCRUAL (VARCHAR): Accrued interest/dividends

**frpindx** - Index Data
- INDX (VARCHAR): Index identifier
- IDATE (VARCHAR): Index date
- IPRICE (VARCHAR): Index price
- IINC (VARCHAR): Index income
- IRET (VARCHAR): Index return

**frptran** - Portfolio Transactions
- Transaction data with account, security, and transaction details

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

      // Create or get conversation
      const finalConversationId = await createOrGetConversation(env, conversationId, userId, provider);
      
      // Save user message
      await saveMessage(env, finalConversationId, 'user', prompt);
      
      // Track tool usage for streaming
      const toolCalls = [];
      
      // Create tools with environment access
      const tools = createTools(env);
      
      // Wrap tools to track usage and provide summaries for large datasets
      const wrappedTools = {};
      Object.keys(tools).forEach(toolName => {
        const tool = tools[toolName];
        wrappedTools[toolName] = {
          ...tool,
          execute: async (params) => {
            const startTime = new Date().toISOString();
            console.log(`[TOOL TRACKER] Calling ${toolName} with:`, params);
            
            const result = await tool.execute(params);
            
            // Store the tool call with results for streaming
            const toolCall = {
              toolName: toolName,
              parameters: params,
              timestamp: startTime,
              result: result
            };
            
            toolCalls.push(toolCall);
            console.log(`[TOOL TRACKER] ${toolName} completed:`, result);
            
            // Return a summary to the AI instead of full data for large datasets
            if (toolName === 'execute_sql' && result.data && result.data.length > 0) {
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
        };
      });

      console.log(`[CHAT] Using provider: ${provider || 'anthropic'}`);
      console.log(`[CHAT] Model:`, getModel(env, provider || 'anthropic'));
      
      // Check API keys
      const selectedProvider = provider || 'anthropic';
      if (selectedProvider === 'anthropic' || selectedProvider === 'claude') {
        console.log(`[CHAT] ANTHROPIC_API_KEY available:`, !!env.ANTHROPIC_API_KEY);
      } else if (selectedProvider === 'groq') {
        console.log(`[CHAT] GROQ_API_KEY available:`, !!env.GROQ_API_KEY);
      } else if (selectedProvider === 'openai') {
        console.log(`[CHAT] OPENAI_API_KEY available:`, !!env.OPENAI_API_KEY);
      }
      
      const result = await streamText({
        model: getModel(env, provider || 'anthropic'),
        system: systemPrompt,
        messages: [
          { role: "user", content: prompt }
        ],
        tools: wrappedTools,
        maxSteps: 5
      });
      
      console.log(`[CHAT] StreamText result created`);

      // Save the conversation and messages after completion in background
      result.text.then(async (fullText) => {
        console.log(`[CHAT] Full response:`, fullText);
        try {
          await saveMessage(env, finalConversationId, 'assistant', fullText, toolCalls.length > 0 ? toolCalls : null);
        } catch (error) {
          console.error('Failed to save assistant message:', error);
        }
      });

      // Use AI SDK's built-in streaming response
      return result.pipeDataStreamToResponse(new Response(), {
        init: {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'X-Vercel-AI-Data-Stream': 'v1'
          }
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  // Get conversation history
  if (url.pathname === "/conversations" && request.method === "GET") {
    try {
      const userId = url.searchParams.get('userId') || '1';
      const limit = parseInt(url.searchParams.get('limit') || '50');
      
      const stmt = env.DB.prepare(`
        SELECT id, model, created_at, updated_at
        FROM conversations 
        WHERE user_id = ? 
        ORDER BY updated_at DESC 
        LIMIT ?
      `);
      const conversations = await stmt.bind(userId, limit).all();
      
      return new Response(JSON.stringify({
        success: true,
        conversations: conversations.results
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  // Get specific conversation messages
  if (url.pathname.startsWith("/conversations/") && request.method === "GET") {
    try {
      const conversationId = url.pathname.split('/')[2];
      
      const stmt = env.DB.prepare(`
        SELECT role, content, tool_calls, created_at
        FROM conversation_messages 
        WHERE conversation_id = ? 
        ORDER BY created_at ASC
      `);
      const messages = await stmt.bind(conversationId).all();
      
      return new Response(JSON.stringify({
        success: true,
        conversationId,
        messages: messages.results?.map(msg => ({
          ...msg,
          tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null
        })) || []
      }), {
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

export default { fetch };
