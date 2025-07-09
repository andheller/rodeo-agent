import { createTools } from "../tools.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

export async function handleClaudeRequest(request, env) {
  try {
    const { prompt } = await request.json();
    
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const apiKey = env.CLAUDE_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Claude API key not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Track tool usage
    const toolCalls = [];
    
    // Create tools with environment access
    const tools = createTools(env);
    
    // System prompt for Claude
    const systemPrompt = `You are a helpful AI assistant with access to mathematical functions and database querying capabilities. You MUST use the available tools to fulfill user requests.

Available tools:
1. execute_sql - Execute SQL SELECT queries against the database (safe to use)
2. prepare_sql_for_user - Prepare UPDATE/INSERT/DELETE queries for user approval
3. Mathematical calculation tools (evaluate_expression, check_mean, check_variance)

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

Your role is to be an analyst and data manager. Provide insights, trends, summaries, and answer questions about the data.`;

    // For now, we'll make a basic Claude API call without tool support
    // In production, you'd implement proper Claude tool calling
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    // Extract the response text from Claude's format
    const responseText = data.content?.[0]?.text || "No response generated";

    return new Response(JSON.stringify({
      response: responseText,
      toolsUsed: toolCalls,
      model: "claude-3-haiku"
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Claude handler error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}