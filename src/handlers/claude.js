import { createTools } from "../tools.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

// Convert our tools to Claude API format
function createClaudeTools(env) {
  const tools = createTools(env);
  
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));
}

// Execute a tool by name
async function executeTool(toolName, input, env) {
  const tools = createTools(env);
  const tool = tools.find(t => t.name === toolName);
  
  if (!tool) {
    throw new Error(`Tool ${toolName} not found`);
  }
  
  return await tool.function(input);
}

export async function handleClaudeRequest(request, env) {
  try {
    const { prompt, messages = [] } = await request.json();
    
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
    const claudeTools = createClaudeTools(env);
    
    // System prompt for Claude
    const systemPrompt = `You are a helpful AI assistant with access to mathematical functions, database querying capabilities, and a comprehensive First Rate Performance knowledge base. You MUST use the available tools to fulfill user requests.

Available tools:
1. execute_sql - Execute SQL SELECT queries against the database (safe to use)
2. prepare_sql_for_user - Prepare UPDATE/INSERT/DELETE queries for user approval
3. Mathematical calculation tools (evaluate_expression, check_mean, check_variance)
4. Knowledge base tools:
   - lookup_knowledge_base - Search for specific terms, definitions, or procedures
   - get_knowledge_base_categories - List available knowledge base categories
   - browse_knowledge_base_category - Browse all entries in a specific category

KNOWLEDGE BASE:
You have access to a comprehensive First Rate Performance knowledge base containing 146 entries across categories like:
- Terminology (88 entries) - Definitions of technical terms
- Data Management (20 entries) - Data processing procedures
- Performance (10 entries) - Performance calculation methods
- Reporting (11 entries) - Report generation procedures
- And more categories covering system functionality

Use the knowledge base tools to:
- Look up definitions of technical terms
- Find procedural information
- Get detailed explanations of system features
- Browse related topics by category

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

    // Build messages array from conversation history
    let claudeMessages = [];
    
    // Add previous messages if available
    if (messages.length > 0) {
      // Use the provided messages history
      claudeMessages = messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }));
    } else {
      // No history, just add current prompt
      claudeMessages = [
        {
          role: "user",
          content: prompt
        }
      ];
    }

    let finalResponse = "";
    let maxIterations = 10; // Prevent infinite loops
    
    // Tool calling loop
    while (maxIterations > 0) {
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 2048,
          system: systemPrompt,
          tools: claudeTools,
          messages: claudeMessages
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${errorData}`);
      }

      const data = await response.json();
      
      // Add Claude's response to messages
      claudeMessages.push({
        role: "assistant",
        content: data.content
      });

      // Check if Claude wants to use tools
      if (data.stop_reason === "tool_use") {
        // Find tool use blocks
        const toolUseBlocks = data.content.filter(block => block.type === "tool_use");
        
        // Execute each tool
        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          try {
            const result = await executeTool(toolUse.name, toolUse.input, env);
            toolCalls.push({
              tool: toolUse.name,
              input: toolUse.input,
              result: result
            });
            
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(result)
            });
          } catch (error) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: error.message }),
              is_error: true
            });
          }
        }
        
        // Add tool results to messages
        claudeMessages.push({
          role: "user",
          content: toolResults
        });
      } else {
        // No more tools to use, extract final response
        finalResponse = data.content.find(block => block.type === "text")?.text || "No response generated";
        break;
      }
      
      maxIterations--;
    }

    return new Response(JSON.stringify({
      response: finalResponse,
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