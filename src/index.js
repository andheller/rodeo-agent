import { Agent } from "agents";
import { runWithTools } from "@cloudflare/ai-utils";
import { tools } from "./tools.js";

export class MathAgent extends Agent {
  async onMessage(conn, raw) {
    const { prompt } = JSON.parse(raw);
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

When a user asks for data:
1. Use execute_sql to query the data they requested
2. Always actually run the queries - don't just describe what you would do
3. Provide analysis, insights, and summaries based on the data you receive
4. Feel free to make follow-up queries for deeper analysis

Your role is to be an analyst, not a data formatter. Provide insights, trends, summaries, and answer questions about the data.`;

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
      endpoints: ["/", "/chat"]
    }), {
      headers: { "Content-Type": "application/json" }
    });
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
