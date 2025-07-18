import { createTools } from "../tools.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Convert our tools to OpenAI function calling format
function createGroqTools(env) {
  const tools = createTools(env);
  
  return tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

// Execute a tool by name
async function executeTool(toolName, arguments_, env) {
  const tools = createTools(env);
  const tool = tools.find(t => t.name === toolName);
  
  if (!tool) {
    throw new Error(`Tool ${toolName} not found`);
  }
  
  return await tool.function(arguments_);
}

export async function handleGroqRequest(request, env) {
  try {
    const { prompt, messages = [] } = await request.json();
    
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Groq API key not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Track tool usage
    const toolCalls = [];
    
    // Create tools with environment access
    const groqTools = createGroqTools(env);
    
    // System prompt for Groq
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
    let groqMessages = [
      {
        role: "system",
        content: systemPrompt
      }
    ];
    
    // Add previous messages if available
    if (messages.length > 0) {
      // Use the provided messages history
      groqMessages = groqMessages.concat(messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      })));
    } else {
      // No history, just add current prompt
      groqMessages.push({
        role: "user",
        content: prompt
      });
    }

    let finalResponse = "";
    let maxIterations = 10; // Prevent infinite loops
    
    // Tool calling loop
    while (maxIterations > 0) {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2-instruct",
          messages: groqMessages,
          tools: groqTools,
          temperature: 0.6,
          max_completion_tokens: 2048,
          top_p: 1,
          stream: false,
          stop: null
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Groq API error: ${response.status} - ${errorData}`);
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0]) {
        throw new Error("Invalid response format from Groq API");
      }

      const choice = data.choices[0];
      const message = choice.message;
      
      // Add assistant's response to messages
      groqMessages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls
      });

      // Check if the assistant wants to use tools
      if (message.tool_calls && message.tool_calls.length > 0) {
        // Execute each tool call
        const toolResults = [];
        for (const toolCall of message.tool_calls) {
          try {
            const result = await executeTool(
              toolCall.function.name, 
              JSON.parse(toolCall.function.arguments), 
              env
            );
            toolCalls.push({
              tool: toolCall.function.name,
              input: JSON.parse(toolCall.function.arguments),
              result: result
            });
            
            toolResults.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            });
          } catch (error) {
            toolResults.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: error.message })
            });
          }
        }
        
        // Add tool results to messages
        groqMessages = groqMessages.concat(toolResults);
      } else {
        // No more tools to use, extract final response
        finalResponse = message.content || "No response generated";
        break;
      }
      
      maxIterations--;
    }

    return new Response(JSON.stringify({
      response: finalResponse,
      toolsUsed: toolCalls,
      model: "moonshotai/kimi-k2-instruct"
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Groq handler error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}