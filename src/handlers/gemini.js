import { createTools } from "../tools.js";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export async function handleGeminiRequest(request, env) {
  try {
    const { prompt, messages = [] } = await request.json();
    
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Track tool usage
    const toolCalls = [];
    
    // Create tools with environment access
    const tools = createTools(env);
    
    // Convert tools to Gemini function declarations
    const functionDeclarations = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));

    // System prompt for Gemini
    const systemPrompt = `You are a helpful AI assistant with access to mathematical functions and database querying capabilities. You MUST use the available tools to fulfill user requests.

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

    // Function to execute tool calls
    async function executeFunctionCall(functionCall) {
      const tool = tools.find(t => t.name === functionCall.name);
      if (!tool) {
        return { error: `Unknown function: ${functionCall.name}` };
      }
      
      try {
        const result = await tool.function(functionCall.args);
        toolCalls.push({ name: functionCall.name, args: functionCall.args, result });
        return result;
      } catch (error) {
        const errorResult = { error: error.message };
        toolCalls.push({ name: functionCall.name, args: functionCall.args, result: errorResult });
        return errorResult;
      }
    }

    // Build conversation history from messages if provided
    let conversationHistory = [];
    
    // Add previous messages if available
    if (messages.length > 0) {
      // Convert messages to Gemini format
      messages.forEach(msg => {
        if (msg.role === 'user') {
          conversationHistory.push({
            role: "user",
            parts: [{ text: msg.content }]
          });
        } else if (msg.role === 'assistant') {
          conversationHistory.push({
            role: "model",
            parts: [{ text: msg.content }]
          });
        }
      });
    } else {
      // No history, just add current prompt
      conversationHistory.push({
        role: "user",
        parts: [{ text: prompt }]
      });
    }

    // Make initial request to Gemini
    let response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: conversationHistory,
        tools: [{
          functionDeclarations: functionDeclarations
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    let data = await response.json();
    let finalResponse = "";
    
    // Handle function calls in a loop
    while (data.candidates?.[0]?.content?.parts) {
      const parts = data.candidates[0].content.parts;
      
      // Add model response to conversation
      conversationHistory.push({
        role: "model",
        parts: parts
      });
      
      // Check for function calls
      const functionCalls = parts.filter(part => part.functionCall);
      
      if (functionCalls.length > 0) {
        // Execute function calls
        const functionResponses = [];
        
        for (const functionCall of functionCalls) {
          const result = await executeFunctionCall(functionCall.functionCall);
          functionResponses.push({
            functionResponse: {
              name: functionCall.functionCall.name,
              response: result
            }
          });
        }
        
        // Add function responses to conversation
        conversationHistory.push({
          role: "user",
          parts: functionResponses
        });
        
        // Continue conversation with function results
        response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: conversationHistory,
            tools: [{
              functionDeclarations: functionDeclarations
            }],
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 4096,
            }
          })
        });
        
        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status}`);
        }
        
        data = await response.json();
      } else {
        // No more function calls, extract final response
        const textParts = parts.filter(part => part.text);
        finalResponse = textParts.map(part => part.text).join('');
        break;
      }
    }

    return new Response(JSON.stringify({
      response: finalResponse || "No response generated",
      toolsUsed: toolCalls,
      model: "gemini-2.5-flash"
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Gemini handler error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}