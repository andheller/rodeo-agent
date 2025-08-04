// Agent Loop System with Smart Context Management
import { createTools } from './tools.js';
import { z } from 'zod';
import { streamAnthropicResponse } from './providers/ai-providers.js';
import { SYSTEM_PROMPT } from './prompts/system-prompt.js';

// Smart truncation strategies by data type
function smartTruncate(toolResult, maxTokens = 1500) {
  if (!toolResult.success) return toolResult;

  switch (toolResult.type || 'default') {
    case 'search_results':
      return truncateSearchResults(toolResult, maxTokens);
    case 'category_browse':
      return truncateCategoryBrowse(toolResult, maxTokens);
    case 'direct_lookup':
      return truncateDirectLookup(toolResult, maxTokens);
    default:
      return truncateQueryResults(toolResult, maxTokens);
  }
}

function truncateQueryResults(result, maxTokens) {
  if (!result.data || result.data.length <= 20) return result;
  
  const sampleSize = Math.min(10, Math.floor(maxTokens / 100));
  return {
    ...result,
    data: [
      ...result.data.slice(0, sampleSize),
      { _summary: `... ${result.data.length - (sampleSize * 2)} rows omitted ...` },
      ...result.data.slice(-sampleSize)
    ],
    truncated: true,
    originalRowCount: result.data.length,
    contextSummary: `Showing first ${sampleSize} and last ${sampleSize} of ${result.data.length} rows`
  };
}

function truncateSearchResults(result, maxTokens) {
  if (!result.results || result.results.length <= 5) return result;
  
  return {
    ...result,
    results: result.results.slice(0, 5),
    truncated: true,
    contextSummary: `Showing top 5 of ${result.totalMatches} matches. Categories: ${result.availableCategories?.map(c => c.displayName).join(', ') || 'various'}`
  };
}

function truncateCategoryBrowse(result, maxTokens) {
  if (!result.results || result.results.length <= 8) return result;
  
  return {
    ...result,
    results: result.results.slice(0, 8),
    truncated: true,
    contextSummary: `Showing first 8 of ${result.totalEntries} entries in ${result.category}`
  };
}

function truncateDirectLookup(result, maxTokens) {
  if (!result.entry?.content) return result;
  
  const content = result.entry.content;
  if (content.length <= maxTokens) return result;
  
  return {
    ...result,
    entry: {
      ...result.entry,
      content: content.substring(0, maxTokens) + "...",
      truncated: true
    },
    contextSummary: `Content truncated. Full entry ID: ${result.entry.id}`
  };
}

// Agent loop conversation manager
class AgentLoop {
  constructor(env, initialMessage, options = {}) {
    console.log('[AGENT] Constructor called with env:', {
      hasEnv: !!env,
      hasApiKey: !!env?.ANTHROPIC_API_KEY,
      envKeys: env ? Object.keys(env) : 'no env'
    });
    
    this.env = env;
    this.tools = createAgentTools(env); // Use agent tools with continue/complete
    this.conversation = [{ role: 'user', content: initialMessage }];
    this.iteration = 0;
    this.maxIterations = options.maxIterations || 10;
    this.maxTokensPerResult = options.maxTokensPerResult || 1500;
    this.isComplete = false;
    
    // Validate API key (temporarily disabled for debugging)
    if (!env || !env.ANTHROPIC_API_KEY) {
      console.error('[AGENT] No ANTHROPIC_API_KEY found in environment');
      console.error('[AGENT] Available env keys:', env ? Object.keys(env) : 'env is null/undefined');
      console.error('[AGENT] Full env object:', env);
      // throw new Error('ANTHROPIC_API_KEY is required for agent loop');
      console.warn('[AGENT] Continuing without API key for debugging...');
    }
  }

  async runLoop() {
    const results = [];
    
    while (!this.isComplete && this.iteration < this.maxIterations) {
      this.iteration++;
      
      try {
        const response = await this.processIteration();
        results.push(response);
        
        // Check if AI wants to continue or complete
        if (response.toolCalls?.some(call => call.name === 'complete_task')) {
          this.isComplete = true;
          break;
        }
        
      } catch (error) {
        results.push({ error: error.message, iteration: this.iteration });
        break;
      }
    }
    
    return {
      completed: this.isComplete,
      iterations: this.iteration,
      results: results,
      finalContext: this.buildContextSummary()
    };
  }

  async processIteration() {
    // This would integrate with your AI service (Claude, etc.)
    // For now, simulating the flow
    
    const iterationContext = {
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      conversationLength: this.conversation.length,
      availableTools: Object.keys(this.tools),
      contextSummary: this.buildContextSummary()
    };
    
    // Mock AI response with tool calls
    const aiResponse = await this.callAI(iterationContext);
    
    // Process any tool calls
    if (aiResponse.toolCalls) {
      const toolResults = await this.executeToolCalls(aiResponse.toolCalls);
      
      // Add truncated results back to conversation
      const truncatedResults = toolResults.map(result => ({
        ...result,
        ...smartTruncate(result, this.maxTokensPerResult)
      }));
      
      this.conversation.push({
        role: 'assistant',
        content: aiResponse.content,
        toolCalls: aiResponse.toolCalls
      });
      
      this.conversation.push({
        role: 'tool',
        content: JSON.stringify(truncatedResults, null, 2)
      });
      
      return {
        iteration: this.iteration,
        aiResponse: aiResponse.content,
        toolResults: truncatedResults,
        contextSummary: truncatedResults.map(r => r.contextSummary).filter(Boolean)
      };
    }
    
    return {
      iteration: this.iteration,
      aiResponse: aiResponse.content,
      toolResults: []
    };
  }

  async executeToolCalls(toolCalls) {
    const results = [];
    
    for (const call of toolCalls) {
      if (this.tools[call.name]) {
        try {
          const result = await this.tools[call.name].execute(call.arguments);
          results.push({
            toolName: call.name,
            arguments: call.arguments,
            ...result
          });
        } catch (error) {
          results.push({
            toolName: call.name,
            arguments: call.arguments,
            error: error.message
          });
        }
      }
    }
    
    return results;
  }

  buildContextSummary() {
    const toolCalls = this.conversation
      .filter(msg => msg.toolCalls)
      .flatMap(msg => msg.toolCalls);
      
    const summary = {
      totalTools: toolCalls.length,
      toolTypes: [...new Set(toolCalls.map(call => call.name))],
      iteration: this.iteration,
      conversationLength: this.conversation.length
    };
    
    return summary;
  }

  async callAI(context) {
    // Build enhanced system prompt with context
    const enhancedSystemPrompt = `${SYSTEM_PROMPT}

AGENT LOOP CONTEXT:
- Iteration: ${context.iteration}/${context.maxIterations}
- Available tools: ${context.availableTools.join(', ')}
- Previous tool calls: ${context.contextSummary.totalTools}
- Conversation length: ${context.conversationLength}

You are running in autonomous agent mode. Use tools to accomplish the task, then either:
- Call continue_agent to keep working if more analysis is needed
- Call complete_task when you have finished the task

Focus on providing value through data analysis and insights.`;

    try {
      // Use Anthropic streaming (we'll process this synchronously for the loop)
      const messages = this.conversation.slice(); // Current conversation
      
      // Add tools converted to Anthropic format
      const anthropicTools = this.convertToolsToAnthropic();
      
      console.log('[AGENT] Calling AI with:', {
        messageCount: messages.length,
        toolCount: anthropicTools.length,
        hasApiKey: !!this.env.ANTHROPIC_API_KEY
      });
      
      // Stream from Anthropic
      const apiStream = await streamAnthropicResponse(
        this.env, 
        messages, 
        enhancedSystemPrompt, 
        'claude-3-5-sonnet-20241022',
        anthropicTools
      );

      // Process stream to extract response and tool calls
      return await this.processAIStream(apiStream);
      
    } catch (error) {
      console.error('[AGENT] AI call error:', error);
      console.error('[AGENT] Error details:', {
        message: error.message,
        env: this.env ? 'present' : 'missing',
        apiKey: this.env?.ANTHROPIC_API_KEY ? 'present' : 'missing'
      });
      return {
        content: `Error calling AI: ${error.message}`,
        toolCalls: []
      };
    }
  }

  convertToolsToAnthropic() {
    return Object.entries(this.tools).map(([name, tool]) => ({
      name: name,
      description: tool.description,
      input_schema: this.convertZodSchemaToJson(tool.inputSchema)
    }));
  }

  convertZodSchemaToJson(zodSchema) {
    if (zodSchema._def?.shape) {
      const properties = {};
      const required = [];

      for (const [key, value] of Object.entries(zodSchema._def.shape)) {
        if (value._def) {
          properties[key] = {
            type: this.getZodType(value._def),
            description: value._def.description || ''
          };
          
          if (!value._def.optional) {
            required.push(key);
          }
        }
      }

      return {
        type: 'object',
        properties,
        required
      };
    }
    return zodSchema;
  }

  getZodType(zodDef) {
    if (zodDef.typeName === 'ZodString') return 'string';
    if (zodDef.typeName === 'ZodNumber') return 'number';
    if (zodDef.typeName === 'ZodBoolean') return 'boolean';
    if (zodDef.typeName === 'ZodArray') return 'array';
    if (zodDef.typeName === 'ZodObject') return 'object';
    return 'string';
  }

  async processAIStream(apiStream) {
    const reader = apiStream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCalls = [];
    let isToolUse = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);

            // Handle Anthropic tool use
            if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
              isToolUse = true;
              toolCalls.push({
                id: data.content_block.id,
                name: data.content_block.name,
                arguments: {}
              });
            } else if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
              // Tool input delta
              if (toolCalls.length > 0) {
                const lastTool = toolCalls[toolCalls.length - 1];
                if (!lastTool.inputBuffer) lastTool.inputBuffer = '';
                lastTool.inputBuffer += data.delta.partial_json;
              }
            } else if (data.type === 'content_block_delta' && data.delta?.text) {
              // Regular text content
              fullContent += data.delta.text;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      // Parse tool arguments
      toolCalls.forEach(tool => {
        console.log('[AGENT] Processing tool for arguments:', {
          name: tool.name,
          hasInputBuffer: !!tool.inputBuffer,
          inputBuffer: tool.inputBuffer
        });
        
        if (tool.inputBuffer) {
          try {
            tool.arguments = JSON.parse(tool.inputBuffer);
            console.log('[AGENT] Parsed arguments:', tool.arguments);
          } catch (e) {
            console.log('[AGENT] Failed to parse arguments, using empty object:', e.message);
            tool.arguments = {};
          }
          delete tool.inputBuffer;
        } else {
          console.log('[AGENT] No input buffer, setting empty arguments');
          tool.arguments = {};
        }
      });

      return {
        content: fullContent,
        toolCalls: toolCalls
      };

    } catch (error) {
      console.error('[AGENT] Stream processing error:', error);
      return {
        content: 'Error processing AI response',
        toolCalls: []
      };
    }
  }
}

// Enhanced tools with continuation support
export function createAgentTools(env) {
  const baseTools = createTools(env);
  
  // Add agent loop control tools
  baseTools.continue_agent = {
    description: "Continue the agent loop to perform more analysis or actions",
    inputSchema: z.object({
      reason: z.string().describe("Why you want to continue (for logging)")
    }),
    execute: ({ reason }) => {
      console.log('AGENT CONTINUES:', reason);
      return {
        success: true,
        action: 'continue',
        reason: reason,
        message: 'Agent will continue processing'
      };
    }
  };
  
  baseTools.complete_task = {
    description: "Signal that the task is complete and stop the agent loop",
    inputSchema: z.object({
      summary: z.string().describe("Summary of what was accomplished"),
      recommendations: z.string().describe("Any recommendations or next steps").optional()
    }),
    execute: ({ summary, recommendations }) => {
      console.log('AGENT COMPLETES:', summary);
      return {
        success: true,
        action: 'complete',
        summary: summary,
        recommendations: recommendations,
        message: 'Task completed successfully'
      };
    }
  };
  
  return baseTools;
}

export { AgentLoop, smartTruncate };