import { streamAnthropicResponse, streamGroqResponse, streamOpenAIResponse } from './providers/ai-providers.js';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_STRING } from './prompts/system-prompt.js';
import { createOrGetConversation, saveMessage } from './utils/conversation.js';
import { createTools } from './tools.js';
import { AI_CONFIG, getModelForProvider, formatLogMessage } from './ai-config.js';

// Smart truncation strategies by data type (extracted from removed agent-loop.js)
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
  // SQL results are now limited to 10 rows at source, so minimal truncation needed
  if (!result.data || result.data.length <= 10) return result;
  
  // Should rarely hit this case with new 10-row limit
  return {
    ...result,
    data: result.data.slice(0, 10),
    truncated: true,
    originalRowCount: result.rowCount || result.data.length,
    contextSummary: `Showing first 10 rows of ${result.rowCount || result.data.length} total rows`
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

// Centralized error handling
export class AIError extends Error {
	constructor(message, code, details = {}) {
		super(message);
		this.name = 'AIError';
		this.code = code;
		this.details = details;
		this.timestamp = new Date().toISOString();
	}

	toJSON() {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			details: this.details,
			timestamp: this.timestamp
		};
	}

	toResponse() {
		const status = this.getHttpStatus();
		return new Response(JSON.stringify({
			error: this.message,
			code: this.code,
			details: this.details
		}), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	getHttpStatus() {
		switch (this.code) {
			case AI_CONFIG.ERROR_CODES.MISSING_INPUT:
			case AI_CONFIG.ERROR_CODES.VALIDATION_ERROR:
				return 400;
			case AI_CONFIG.ERROR_CODES.API_KEY_MISSING:
				return 401;
			case AI_CONFIG.ERROR_CODES.TOOL_NOT_FOUND:
				return 404;
			default:
				return 500;
		}
	}
}

// Convert internal tools to Anthropic format
function convertToolsToAnthropic(tools) {
	return Object.entries(tools).map(([name, tool]) => ({
		name: name,
		description: tool.description,
		input_schema: tool.inputSchema._def.shape ? 
			convertZodSchemaToJson(tool.inputSchema._def.shape) : 
			tool.inputSchema
	}));
}

// Convert Zod schema to JSON schema
function convertZodSchemaToJson(zodShape) {
	const properties = {};
	const required = [];

	for (const [key, value] of Object.entries(zodShape)) {
		if (value._def) {
			properties[key] = {
				type: getZodType(value._def),
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

// Get JSON schema type from Zod type
function getZodType(zodDef) {
	if (zodDef.typeName === 'ZodString') return 'string';
	if (zodDef.typeName === 'ZodNumber') return 'number';
	if (zodDef.typeName === 'ZodBoolean') return 'boolean';
	if (zodDef.typeName === 'ZodArray') return 'array';
	if (zodDef.typeName === 'ZodObject') return 'object';
	return 'string';
}

// Helper function to add cache control to messages for Anthropic
function addCacheControlToMessages(messages, cacheFromIndex = 0) {
	if (!messages || messages.length === 0) return messages;
	
	// Clone messages to avoid mutation
	const cachedMessages = messages.map((msg, index) => {
		// Cache messages starting from cacheFromIndex, but not the very last message
		// (the current user input shouldn't be cached yet)
		if (index >= cacheFromIndex && index < messages.length - 1) {
			return {
				...msg,
				content: Array.isArray(msg.content) 
					? msg.content.map((block, blockIndex) => 
						// Add cache_control to the last content block of this message
						blockIndex === msg.content.length - 1 
							? { ...block, cache_control: { type: "ephemeral" } }
							: block
					)
					: [{ 
						type: "text", 
						text: msg.content, 
						cache_control: { type: "ephemeral" } 
					}]
			};
		}
		
		// For non-cached messages, ensure content is in array format for Anthropic
		return {
			...msg,
			content: Array.isArray(msg.content) 
				? msg.content 
				: [{ type: "text", text: msg.content }]
		};
	});
	
	return cachedMessages;
}

// Build conversation history XML from messages
function buildConversationHistoryXML(messages) {
	if (!messages || messages.length === 0) return '';
	
	let xml = '';
	let currentTurn = null;
	
	for (const msg of messages) {
		// Extract content text regardless of format
		const content = Array.isArray(msg.content) 
			? msg.content.map(block => block.text || block.content || '').join(' ')
			: msg.content || '';
		
		if (msg.role === 'user') {
			// Close previous turn if exists
			if (currentTurn) {
				xml += '</turn>\n';
			}
			// Start new turn
			xml += '<turn>\n';
			xml += `<user>${content}</user>\n`;
			currentTurn = 'user';
		} else if (msg.role === 'assistant') {
			xml += `<assistant>${content}</assistant>\n`;
			
			// Add tool calls if they exist
			if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
				for (const toolCall of msg.tool_calls) {
					const toolInput = typeof toolCall.input === 'string' 
						? toolCall.input 
						: JSON.stringify(toolCall.input || {});
					xml += `<tool_use>${toolCall.name}: ${toolInput}</tool_use>\n`;
				}
			}
			currentTurn = 'assistant';
		}
	}
	
	// Close final turn
	if (currentTurn) {
		xml += '</turn>\n';
	}
	
	return xml.trim();
}

// Build cached system prompt with conversation history (respects 4 breakpoint limit)
function buildCachedSystemWithHistory(messages, maxHistoryMessages = 6) {
	// Use consolidated system prompt (1 breakpoint)
	const systemBlocks = [...SYSTEM_PROMPT];
	
	// Determine which messages to include in history vs recent cache
	const totalMessages = messages.length;
	
	if (totalMessages <= 2) {
		// Short conversation - no history block needed, use message caching
		return systemBlocks;
	}
	
	// For longer conversations, move older messages to history XML
	const historyMessages = messages.slice(0, Math.max(0, totalMessages - maxHistoryMessages));
	
	if (historyMessages.length > 0) {
		const historyXML = buildConversationHistoryXML(historyMessages);
		
		if (historyXML) {
			// Add conversation history block (breakpoint 2)
			systemBlocks.push({
				type: "text",
				text: `<conversation_history>\n${historyXML}\n</conversation_history>`,
				cache_control: { type: "ephemeral" }
			});
		}
	}
	
	return systemBlocks;
}

// Smart message caching that respects 4 breakpoint limit
function smartCacheMessages(messages, systemBreakpoints = 1) {
	if (!messages || messages.length === 0) return messages;
	
	// Calculate available breakpoints for messages (4 total - system breakpoints)  
	const availableBreakpoints = 4 - systemBreakpoints;
	
	// For short conversations, cache recent messages directly
	if (messages.length <= availableBreakpoints) {
		return addCacheControlToMessages(messages, 0);
	}
	
	// For longer conversations, only cache the most recent messages
	// Leave the last message uncached (current user input)
	const recentMessages = messages.slice(-availableBreakpoints);
	const olderMessages = messages.slice(0, -availableBreakpoints);
	
	// Format older messages for Anthropic (no caching)
	const formattedOlderMessages = olderMessages.map(msg => ({
		...msg,
		content: Array.isArray(msg.content) 
			? msg.content 
			: [{ type: "text", text: msg.content }]
	}));
	
	// Cache recent messages (except the very last one)
	const cachedRecentMessages = addCacheControlToMessages(recentMessages, 0);
	
	return [...formattedOlderMessages, ...cachedRecentMessages];
}

// Execute a tool call
async function executeTool(toolName, toolInput, tools, env) {
	
	if (!tools[toolName]) {
		throw new AIError(
			`Tool ${toolName} not found`,
			AI_CONFIG.ERROR_CODES.TOOL_NOT_FOUND,
			{ toolName, availableTools: Object.keys(tools) }
		);
	}

	try {
		const startTime = Date.now();
		const result = await tools[toolName].execute(toolInput);
		const duration = Date.now() - startTime;
		
		if (AI_CONFIG.LOGGING.ENABLE_TOOL_LOGGING) {
			formatLogMessage(AI_CONFIG.LOGGING.LOG_PREFIXES.TOOL, `${toolName} executed in ${duration}ms`);
		}
		
		return result;
	} catch (error) {
		formatLogMessage(AI_CONFIG.LOGGING.LOG_PREFIXES.ERROR, `${toolName} error:`, error);
		return { error: error.message };
	}
}

// Chat endpoint with streaming and tool support
export async function handleChat(env, request) {
	try {
		const { 
			prompt, 
			provider, 
			model, 
			conversationId, 
			userId = 1, 
			messages, 
			enableLoop = AI_CONFIG.CHAT_LOOP.ENABLE_LOOP_DEFAULT, 
			maxIterations = AI_CONFIG.CHAT_LOOP.MAX_ITERATIONS 
		} = await request.json();

	// Support legacy 'prompt' or new 'messages' format
	const finalMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : null);

	if (!finalMessages || finalMessages.length === 0) {
		throw new AIError(
			'Missing prompt or messages',
			AI_CONFIG.ERROR_CODES.MISSING_INPUT,
			{ prompt, messagesLength: messages?.length || 0 }
		);
	}

	// Create or get conversation
	const finalConversationId = await createOrGetConversation(env, conversationId, userId, provider);

	// Save user message - extract content from messages array
	const userContent = finalMessages[finalMessages.length - 1]?.content || '';
	await saveMessage(env, finalConversationId, 'user', userContent);


	// Default to groq with gpt-oss-120b when no provider specified
	let selectedProvider = provider || 'groq';
	let selectedModel = model || 'openai/gpt-oss-120b';
	
	if (selectedProvider === 'default') {
		selectedProvider = 'groq';
		selectedModel = 'openai/gpt-oss-120b';
	}
	if (selectedProvider === 'anthropic' || selectedProvider === 'claude') {
		if (!env.ANTHROPIC_API_KEY) {
			throw new AIError(
				'ANTHROPIC_API_KEY not configured',
				AI_CONFIG.ERROR_CODES.API_KEY_MISSING,
				{ provider: selectedProvider }
			);
		}
	} else if (selectedProvider === 'groq') {
		if (!env.GROQ_API_KEY) {
			throw new AIError(
				'GROQ_API_KEY not configured',
				AI_CONFIG.ERROR_CODES.API_KEY_MISSING,
				{ provider: selectedProvider }
			);
		}
	} else if (selectedProvider === 'openai') {
		if (!env.OPENAI_API_KEY) {
			throw new AIError(
				'OPENAI_API_KEY not configured',
				AI_CONFIG.ERROR_CODES.API_KEY_MISSING,
				{ provider: selectedProvider }
			);
		}
	} else if (selectedProvider === 'gemini') {
		// Reroute Gemini requests to Claude Haiku 3.5
		if (!env.ANTHROPIC_API_KEY) {
			throw new AIError(
				'ANTHROPIC_API_KEY not configured (required for Gemini rerouting)',
				AI_CONFIG.ERROR_CODES.API_KEY_MISSING,
				{ provider: selectedProvider, note: 'Gemini is rerouted to Claude Haiku' }
			);
		}
	}

	// Create tools
	const tools = createTools(env);
	const anthropicTools = convertToolsToAnthropic(tools);

	// API stream will be created inside the loop

	// Create manual streaming response with tool support
	const encoder = new TextEncoder();
	
	const stream = new ReadableStream({
		async start(controller) {
			try {
				// Send conversation ID first
				const initData = `data: ${JSON.stringify({ type: 'conversation_id', conversationId: finalConversationId })}\n\n`;
				controller.enqueue(encoder.encode(initData));

				// Loop variables
				let currentIteration = 0;
				let shouldContinueLoop = true;
				let currentMessages = [...finalMessages]; // Copy to avoid mutation

				while (shouldContinueLoop && currentIteration < maxIterations) {
					currentIteration++;
					
					if (AI_CONFIG.LOGGING.ENABLE_LOOP_LOGGING) {
						formatLogMessage(AI_CONFIG.LOGGING.LOG_PREFIXES.CHAT_LOOP, `Starting iteration ${currentIteration}/${maxIterations}`);
					}
					
					// Send iteration marker if looping
					if (enableLoop && currentIteration > 1) {
						if (AI_CONFIG.LOGGING.ENABLE_LOOP_LOGGING) {
							formatLogMessage(AI_CONFIG.LOGGING.LOG_PREFIXES.CHAT_LOOP, 'Sending iteration marker to client');
						}
						const iterationData = `data: ${JSON.stringify({ 
							type: 'iteration', 
							iteration: currentIteration,
							maxIterations: maxIterations
						})}\n\n`;
						controller.enqueue(encoder.encode(iterationData));
					}

					// Reset for this iteration
					let fullResponse = '';
					let toolCalls = [];
					let isToolUse = false;

					// Get AI stream for current messages
					let apiStream;
					try {
						if (selectedProvider === 'anthropic' || selectedProvider === 'claude') {
							// Use smart caching with conversation history rotation
							const systemWithHistory = buildCachedSystemWithHistory(currentMessages);
							const systemBreakpoints = systemWithHistory.length;
							const smartCachedMessages = smartCacheMessages(currentMessages, systemBreakpoints);
							apiStream = await streamAnthropicResponse(env, smartCachedMessages, systemWithHistory, getModelForProvider(selectedProvider, selectedModel), anthropicTools);
						} else if (selectedProvider === 'groq') {
							apiStream = await streamGroqResponse(env, currentMessages, SYSTEM_PROMPT_STRING, getModelForProvider(selectedProvider, selectedModel), anthropicTools);
						} else if (selectedProvider === 'openai') {
							apiStream = await streamOpenAIResponse(env, currentMessages, SYSTEM_PROMPT_STRING, getModelForProvider(selectedProvider, selectedModel), anthropicTools);
						} else if (selectedProvider === 'gemini') {
							// Reroute Gemini to Claude Haiku with smart caching
							const systemWithHistory = buildCachedSystemWithHistory(currentMessages);
							const systemBreakpoints = systemWithHistory.length;
							const smartCachedMessages = smartCacheMessages(currentMessages, systemBreakpoints);
							apiStream = await streamAnthropicResponse(env, smartCachedMessages, systemWithHistory, getModelForProvider('gemini', selectedModel), anthropicTools);
						} else {
							throw new Error(`Unsupported provider: ${selectedProvider}`);
						}
					} catch (streamError) {
						console.error('[STREAM] Error calling AI API:', streamError.message);
						const errorData = `data: ${JSON.stringify({ type: 'error', content: 'AI API error occurred' })}\n\n`;
						controller.enqueue(encoder.encode(errorData));
						break;
					}

					// Read from API stream manually
					const reader = apiStream.getReader();
					const decoder = new TextDecoder();
					let buffer = '';

					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}

					const chunk = decoder.decode(value, { stream: true });
					
					// Check if chunk is direct JSON without newlines
					if (chunk.trim() && !chunk.includes('\n') && (chunk.includes('"choices"') || chunk.includes('"delta"'))) {
						try {
							const directData = JSON.parse(chunk.trim());
							
							if (selectedProvider === 'groq' || selectedProvider === 'openai') {
								if (directData.choices?.[0]?.delta?.tool_calls) {
									isToolUse = true;
									// Handle direct tool calls similar to line processing
									for (const toolCallDelta of directData.choices[0].delta.tool_calls) {
										const index = toolCallDelta.index || 0;
										if (!toolCalls[index]) {
											toolCalls[index] = { id: toolCallDelta.id || '', name: '', input: '' };
										}
										if (toolCallDelta.function) {
											if (toolCallDelta.function.name) toolCalls[index].name = toolCallDelta.function.name;
											if (toolCallDelta.function.arguments) {
												if (toolCallDelta.function.arguments === 'null' || toolCallDelta.function.arguments === null) {
													toolCalls[index].input = '{}';
												} else {
													toolCalls[index].input += toolCallDelta.function.arguments;
												}
											}
										}
									}
								} else if (directData.choices?.[0]?.delta?.content) {
									const content = directData.choices[0].delta.content;
									if (content !== null && content !== undefined) {
										fullResponse += content;
										const streamData = `data: ${JSON.stringify({ type: 'text', content })}\n\n`;
										controller.enqueue(encoder.encode(streamData));
									}
								}
							}
							continue;
						} catch (e) {
						}
					}
					buffer += chunk;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						// Handle direct JSON lines (Groq/OpenAI format) or SSE format
						let dataStr = '';
						let data = null;
						
						if (line.startsWith('data: ')) {
							// SSE format
							dataStr = line.slice(6);
							// Skip [DONE] marker
							if (dataStr === '[DONE]') {
								continue;
							}
						} else if (line.startsWith('event: ')) {
							// SSE event type - log and continue without trying to parse as JSON
							const eventType = line.slice(7);
							continue;
						} else if (line.trim() && !line.startsWith(':') && !line.startsWith('id: ') && !line.startsWith('retry: ')) {
							// Direct JSON line format (Groq/OpenAI) - exclude other SSE headers
							dataStr = line.trim();
						}
						
						if (dataStr) {
							try {
								data = JSON.parse(dataStr);

								// Handle different provider formats
								if (selectedProvider === 'anthropic' || selectedProvider === 'claude') {
									// Handle Anthropic tool use
									if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
										isToolUse = true;
										toolCalls.push({
											id: data.content_block.id,
											name: data.content_block.name,
											input: ''
										});
									} else if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
										// Tool input delta
										if (toolCalls.length > 0) {
											toolCalls[toolCalls.length - 1].input += data.delta.partial_json;
										}
									} else if (data.type === 'content_block_delta' && data.delta?.text) {
										// Regular text content
										const content = data.delta.text;
										fullResponse += content;
										const streamData = `data: ${JSON.stringify({ type: 'text', content })}\n\n`;
										controller.enqueue(encoder.encode(streamData));
									}
								} else if (selectedProvider === 'groq' || selectedProvider === 'openai') {
									// Handle OpenAI-compatible tool calls
									if (data.choices?.[0]?.delta?.tool_calls) {
										isToolUse = true;
										
										// Handle streaming tool calls - accumulate them
										for (const toolCallDelta of data.choices[0].delta.tool_calls) {
											const index = toolCallDelta.index || 0;
											
											// Initialize tool call if it doesn't exist
											if (!toolCalls[index]) {
												toolCalls[index] = {
													id: toolCallDelta.id || '',
													name: '',
													input: ''
												};
											}
											
											// Update tool call data
											if (toolCallDelta.function) {
												if (toolCallDelta.function.name) {
													toolCalls[index].name = toolCallDelta.function.name;
												}
												if (toolCallDelta.function.arguments) {
													// Handle null arguments from Groq
													if (toolCallDelta.function.arguments === 'null' || toolCallDelta.function.arguments === null) {
														toolCalls[index].input = '{}';
													} else {
														toolCalls[index].input += toolCallDelta.function.arguments;
													}
												}
											}
										}
									} else if (data.choices?.[0]?.delta?.content) {
										const content = data.choices[0].delta.content;
										if (content !== null && content !== undefined) {
											fullResponse += content;
											const streamData = `data: ${JSON.stringify({ type: 'text', content })}\n\n`;
											controller.enqueue(encoder.encode(streamData));
										}
									}
								}
							} catch (e) {
								console.warn('Failed to parse streaming JSON data:', dataStr.substring(0, 100));
							}
						}
					}
				}

				// Process tool calls if any (filter out empty ones)
				console.log('[DEBUG] toolCalls array:', JSON.stringify(toolCalls, null, 2));
				const validToolCalls = toolCalls.filter(tc => tc && tc.name);
				console.log('[DEBUG] validToolCalls length:', validToolCalls.length);
				const executedToolResults = []; // Store results for conversation loop
				if (validToolCalls.length > 0) {
					
					for (const toolCall of validToolCalls) {
						try {
							// Parse the tool input, handle empty/null cases
							let toolInput = {};
							if (toolCall.input && toolCall.input !== '{}' && toolCall.input !== 'null') {
								toolInput = JSON.parse(toolCall.input);
							}
							
							// Special handling for SQL tools that might need default queries
							if (toolCall.name === 'execute_sql') {
								// Handle both 'sql' and 'query' parameters
								if (toolInput.sql && !toolInput.query) {
									toolInput.query = toolInput.sql;
								}
								if (!toolInput.query || toolInput.query === '') {
									// Provide a default query for demonstration
									toolInput.query = 'SELECT COUNT(*) as total_accounts FROM FRPAIR';
								}
							}
							
							
							// Execute the tool
							console.log(`[TOOL EXEC] ${toolCall.name} with input:`, JSON.stringify(toolInput).substring(0, 100));
							const toolResult = await executeTool(toolCall.name, toolInput, tools, env);
							console.log(`[TOOL RESULT] ${toolCall.name} result:`, JSON.stringify(toolResult).substring(0, 200));
							
							// Store result for conversation loop
							executedToolResults.push({
								tool_call_id: toolCall.id,
								content: JSON.stringify(toolResult)
							});
							
							// Send tool result to client
							console.log(`[DEBUG] About to stream tool result for ${toolCall.name}`);
							// Special handling for batch_tool - expand batch_results into separate tool_result events
							if (toolCall.name === 'batch_tool' && toolResult.batch_results) {
								// Send each batch result as a separate tool_result event
								toolResult.batch_results.forEach((batchResult, index) => {
									const originalInvocation = toolInput.invocations?.[index];
									const batchToolData = `data: ${JSON.stringify({ 
										type: 'tool_result', 
										toolName: originalInvocation?.name || 'unknown_tool',
										toolInput: originalInvocation?.arguments || {},
										result: batchResult 
									})}\n\n`;
									controller.enqueue(encoder.encode(batchToolData));
								});
								
								// Also send the batch summary as a separate event
								const batchSummary = {
									success: toolResult.success,
									total_invocations: toolResult.total_invocations,
									successful_invocations: toolResult.successful_invocations,
									message: toolResult.message
								};
								const batchSummaryData = `data: ${JSON.stringify({ 
									type: 'tool_result', 
									toolName: 'batch_tool_summary',
									toolInput,
									result: batchSummary 
								})}\n\n`;
								controller.enqueue(encoder.encode(batchSummaryData));
							} else {
								// Regular single tool result
								console.log(`[DEBUG] Streaming regular tool result for ${toolCall.name}`);
								const toolData = `data: ${JSON.stringify({ 
									type: 'tool_result', 
									toolName: toolCall.name,
									toolInput,
									result: toolResult 
								})}\n\n`;
								controller.enqueue(encoder.encode(toolData));
							}

							// If tool requires approval, include that in the response
							if (toolResult.requiresApproval) {
								fullResponse += `\n\n${toolResult.message}`;
							} else if (toolResult.error) {
								fullResponse += `\n\nTool error: ${toolResult.error}`;
							} else if (toolCall.name === 'complete_task' && toolResult.response) {
								// For complete_task, include the response directly in the conversation
								fullResponse += `\n\n${toolResult.response}`;
							} else if (toolResult.message && !toolCall.name.includes('knowledge_base') && toolCall.name !== 'batch_tool') {
								// Don't add knowledge base or batch tool messages to fullResponse as they're displayed in tool results
								fullResponse += `\n\n${toolResult.message}`;
							}

						} catch (toolError) {
							console.error('[TOOL] Error processing tool call:', toolError);
							
							// Store error result for conversation loop
							executedToolResults.push({
								tool_call_id: toolCall.id,
								content: JSON.stringify({ error: toolError.message })
							});
							
							const errorData = `data: ${JSON.stringify({ 
								type: 'tool_error', 
								toolName: toolCall.name,
								error: toolError.message 
							})}\n\n`;
							controller.enqueue(encoder.encode(errorData));
						}
					}
				}

				// Check if we should continue looping
				if (enableLoop) {
					// Add current AI response to conversation (no tool_calls field for Anthropic)
					currentMessages.push({
						role: 'assistant',
						content: fullResponse
					});

					// Add tool results if any (use stored results from first execution)
					if (executedToolResults.length > 0) {
						const validToolCallsForLoop = toolCalls.filter(tc => tc && tc.name);

						// Add tool results to conversation with better formatting
						const formatToolResult = (result) => {
							try {
								const parsed = JSON.parse(result.content);
								
								// Handle SQL results - truncate large datasets but keep context
								if (parsed.data && Array.isArray(parsed.data)) {
									if (parsed.data.length > 10) {
										const truncated = {
											...parsed,
											data: [
												...parsed.data.slice(0, 5),
												{ _note: `[Showing first 5 and last 5 of ${parsed.data.length} total rows]` },
												...parsed.data.slice(-5)
											],
											_summary: `Retrieved ${parsed.data.length} rows from query`
										};
										return JSON.stringify(truncated, null, 2);
									} else {
										return JSON.stringify(parsed, null, 2);
									}
								}
								
								// Handle knowledge base results with better formatting
								if (parsed.results && Array.isArray(parsed.results)) {
									return JSON.stringify(parsed, null, 2);
								}
								
								// Handle other results - truncate very long content but preserve structure
								const resultStr = JSON.stringify(parsed, null, 2);
								if (resultStr.length > 4000) {
									return resultStr.substring(0, 3800) + '\n...\n[Content truncated for length]';
								}
								return resultStr;
								
							} catch (e) {
								// If not JSON, format as text
								return result.content.length > 4000 ? 
									result.content.substring(0, 3800) + '\n[Content truncated for length]' : 
									result.content;
							}
						};

						// Format tool results as structured user message for better context
						const toolResultsContent = executedToolResults.map(result => {
							const toolName = validToolCallsForLoop.find(tc => tc.id === result.tool_call_id)?.name || 'unknown';
							return `## Tool Result: ${toolName}\n\n${formatToolResult(result)}`;  
						}).join('\n\n---\n\n');
						
						currentMessages.push({
							role: 'user',
							content: `Here are the results from your tool calls:\n\n${toolResultsContent}\n\nIMPORTANT: The tool results above are automatically displayed to the user in a separate section. Your response should ONLY contain your analysis and final answer. DO NOT include any tool result data, knowledge base content, or "Knowledge Base Result" sections in your response. Just provide your analysis and conclusions based on the data you received.`
						});

						// Enhanced continuation logic: continue if continue_agent called OR if analysis could benefit from more depth
						const hasContinueAgent = validToolCalls.some(tc => tc.name === 'continue_agent');
						const hasCompleteTask = validToolCalls.some(tc => tc.name === 'complete_task');
						const hasPrepareSQL = validToolCalls.some(tc => tc.name === 'prepare_sql_for_user');
						const hasAnalysisTools = validToolCalls.some(tc => ['execute_sql', 'lookup_knowledge_base', 'browse_knowledge_base_category', 'get_knowledge_base_categories', 'batch_tool'].includes(tc.name));
						
						// Continue if: continue_agent called OR (analysis tools used AND no complete_task AND no prepare_sql AND under max iterations)
						// Stop if: complete_task called OR prepare_sql_for_user called (waiting for user approval)
						shouldContinueLoop = hasContinueAgent || 
											(!hasCompleteTask && !hasPrepareSQL && hasAnalysisTools && currentIteration < maxIterations);
						
						console.log(`[CHAT LOOP] Tool calls: ${validToolCalls.map(tc => tc.name).join(', ')}`);
						console.log(`[CHAT LOOP] Continue conditions - continue_agent: ${hasContinueAgent}, complete_task: ${hasCompleteTask}, prepare_sql: ${hasPrepareSQL}, analysis_tools: ${hasAnalysisTools}, iteration: ${currentIteration}/${maxIterations}`);
						console.log(`[CHAT LOOP] Continue loop: ${shouldContinueLoop}`);
					} else {
						// No tools called, stop looping
						shouldContinueLoop = false;
						console.log(`[CHAT LOOP] No tools called, stopping loop`);
					}
				} else {
					// Loop not enabled, stop after first iteration
					shouldContinueLoop = false;
					console.log(`[CHAT LOOP] Loop not enabled, stopping after iteration ${currentIteration}`);
				}

				// If this is the last iteration, save to database
				if (!shouldContinueLoop || currentIteration >= maxIterations) {
					console.log(`[CHAT LOOP] Ending loop - shouldContinue: ${shouldContinueLoop}, iteration: ${currentIteration}/${maxIterations}`);
					// Save the full conversation to database
					try {
						await saveMessage(env, finalConversationId, 'assistant', fullResponse, toolCalls.length > 0 ? toolCalls : null);
					} catch (error) {
						console.error('Failed to save assistant message:', error);
					}

					// Send end signal
					const endData = `data: ${JSON.stringify({ type: 'done' })}\n\n`;
					controller.enqueue(encoder.encode(endData));
					controller.close();
					break; // Exit the while loop
				}
			} // End of while loop
			} catch (error) {
				console.error('Streaming error:', error);
				const errorData = `data: ${JSON.stringify({ type: 'error', content: 'Streaming error occurred' })}\n\n`;
				controller.enqueue(encoder.encode(errorData));
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: AI_CONFIG.STREAMING.HEADERS
	});
	
	} catch (error) {
		formatLogMessage(AI_CONFIG.LOGGING.LOG_PREFIXES.ERROR, 'Chat endpoint error:', error);
		if (error instanceof AIError) {
			return error.toResponse();
		}
		return new AIError(
			'Internal server error',
			AI_CONFIG.ERROR_CODES.API_ERROR,
			{ error: error.message }
		).toResponse();
	}
}

// Grader endpoint - evaluate query results with Claude
export async function handleGrader(env, request) {
	try {
		const { task, output } = await request.json();

		if (!task || !output) {
			throw new AIError(
				'Missing task or output',
				AI_CONFIG.ERROR_CODES.MISSING_INPUT,
				{ hasTask: !!task, hasOutput: !!output }
			);
		}

		if (!env.ANTHROPIC_API_KEY) {
			throw new AIError(
				'ANTHROPIC_API_KEY not configured',
				AI_CONFIG.ERROR_CODES.API_KEY_MISSING,
				{ service: 'grader' }
			);
		}

		const evalPrompt = `You are an expert code and query reviewer. Your task is to evaluate the following AI-generated solution.

Original Task:
<task>
${task}
</task>

Solution to Evaluate:
<solution>
${output}
</solution>

Output Format
Provide your evaluation as a structured JSON object with the following fields, in this specific order:
- "strengths": An array of 1-3 key strengths
- "weaknesses": An array of 1-3 key areas for improvement  
- "reasoning": A concise explanation of your overall assessment
- "score": A number between 1-10

Respond with JSON. Keep your response concise and direct.
Example response shape:
{
    "strengths": string[],
    "weaknesses": string[],
    "reasoning": string,
    "score": number
}`;

		// Use Anthropic API to grade the result
		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': env.ANTHROPIC_API_KEY,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: AI_CONFIG.DEFAULT_MODELS.grader,
				max_tokens: AI_CONFIG.GRADER.MAX_TOKENS,
				messages: [
					{
						role: 'user',
						content: evalPrompt,
					},
					{
						role: 'assistant',
						content: '```json',
					},
				],
				stop_sequences: AI_CONFIG.GRADER.STOP_SEQUENCES,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[GRADER] Anthropic API error:', errorText);
			return new Response(JSON.stringify({ error: 'Grading failed' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const data = await response.json();
		const gradeText = data.content?.[0]?.text;

		if (!gradeText) {
			return new Response(JSON.stringify({ error: 'Invalid response from grading service' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		try {
			const grade = JSON.parse(gradeText);
			return new Response(JSON.stringify({
				success: true,
				grade,
				task,
				output
			}), {
				headers: { 
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Headers': 'Content-Type',
				},
			});
		} catch (parseError) {
			console.error('[GRADER] Failed to parse grade JSON:', gradeText);
			return new Response(JSON.stringify({ error: 'Failed to parse grading result' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}

	} catch (error) {
		console.error('[GRADER] Error:', error);
		return new Response(JSON.stringify({ error: 'Grader service error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}