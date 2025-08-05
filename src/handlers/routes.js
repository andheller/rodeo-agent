import { streamAnthropicResponse, streamGroqResponse, streamOpenAIResponse } from '../providers/ai-providers.js';
import { SYSTEM_PROMPT } from '../prompts/system-prompt.js';
import { createOrGetConversation, saveMessage } from '../utils/conversation.js';
import { handleD1Proxy } from './d1-proxy.js';
import { handleFileUpload, handleFilesList, handleFileGet, handleFileDelete } from './file-management.js';
import { createTools } from '../tools.js';
import { AgentLoop, smartTruncate, createAgentTools } from '../agent-loop.js';

// Authentication helper
function checkApiAuth(request) {
	const apiKey = request.headers.get('x-api-key');
	return apiKey && apiKey === 'secret123';
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

// Execute a tool call
async function executeTool(toolName, toolInput, tools, env) {
	
	if (!tools[toolName]) {
		throw new Error(`Tool ${toolName} not found`);
	}

	try {
		const result = await tools[toolName].execute(toolInput);
		return result;
	} catch (error) {
		console.error(`[TOOL] ${toolName} error:`, error);
		return { error: error.message };
	}
}


// Test fetch endpoint
export async function handleTestFetch() {
	try {
		const testResponse = await fetch('https://httpbin.org/get');
		const testData = await testResponse.text();
		return new Response(
			JSON.stringify({
				success: true,
				status: testResponse.status,
				data: testData.substring(0, 200) + '...',
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	} catch (error) {
		console.error('[TEST] Fetch failed:', error.message);
		return new Response(
			JSON.stringify({
				success: false,
				error: error.message,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

// Agent endpoint - autonomous task execution
export async function handleAgent(env, request) {
	const requestData = await request.json();
	
	// Support both chat format (prompt/messages) and agent format (task)
	const { 
		prompt, 
		messages, 
		task, 
		maxIterations = 10, 
		maxTokensPerResult = 1500, 
		userId = 1,
		conversationId,
		provider,
		model
	} = requestData;

	// Extract task from prompt, messages, or direct task parameter
	let finalTask;
	if (task) {
		finalTask = task;
	} else if (messages && messages.length > 0) {
		finalTask = messages[messages.length - 1]?.content || '';
	} else if (prompt) {
		finalTask = prompt;
	}

	if (!finalTask) {
		return new Response(JSON.stringify({ error: 'Missing task/prompt description' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}


	// Create or get conversation for compatibility with frontend
	const finalConversationId = conversationId || await createOrGetConversation(env, conversationId, userId, provider || 'anthropic');
	
	// Save user message for compatibility
	await saveMessage(env, finalConversationId, 'user', finalTask);

	// Early fallback check for simple queries (SQL, knowledge base, definitions)
	const isSimpleQuery = !env.ANTHROPIC_API_KEY || 
	    finalTask.toLowerCase().includes('methodology') || 
	    finalTask.toLowerCase().includes('definition') ||
	    finalTask.toLowerCase().includes('what is') ||
	    finalTask.toLowerCase().includes('select ') ||
	    finalTask.toLowerCase().includes('from ') ||
	    finalTask.toLowerCase().includes('limit ');
	
	if (isSimpleQuery) {
		
		try {
			const tools = createTools(env);
			let fallbackResponse = '';
			let toolResult = null;
			
			// Check if it's a SQL query
			if (finalTask.toLowerCase().includes('select ') || finalTask.toLowerCase().includes('from ')) {
				toolResult = await tools.execute_sql.execute({
					query: finalTask.trim()
				});
				
				fallbackResponse = `📊 **SQL Query Results**\n\n`;
				fallbackResponse += `Query: \`${finalTask.trim()}\`\n\n`;
				
				if (toolResult.success && toolResult.data) {
					fallbackResponse += `Retrieved ${toolResult.data.length} rows:\n\n`;
					
					// Show results in a table-like format
					if (toolResult.data.length > 0) {
						const columns = toolResult.columns || Object.keys(toolResult.data[0]);
						
						// Header
						fallbackResponse += `| ${columns.join(' | ')} |\n`;
						fallbackResponse += `|${columns.map(() => '---').join('|')}|\n`;
						
						// Data rows (limit to first 10 for readability)
						const rowsToShow = toolResult.data.slice(0, 10);
						rowsToShow.forEach(row => {
							const values = columns.map(col => row[col] || '');
							fallbackResponse += `| ${values.join(' | ')} |\n`;
						});
						
						if (toolResult.data.length > 10) {
							fallbackResponse += `\n... and ${toolResult.data.length - 10} more rows\n`;
						}
					}
				} else if (toolResult.error) {
					fallbackResponse += `❌ Error: ${toolResult.error}\n`;
				}
			} else {
				// Knowledge base search
				toolResult = await tools.lookup_knowledge_base.execute({
					query: finalTask,
					detailed: true
				});
				
				fallbackResponse = `🔍 **Knowledge Base Search**\n\n`;
				if (toolResult.success && toolResult.results) {
					fallbackResponse += `Found ${toolResult.results.length} results:\n\n`;
					toolResult.results.forEach((result, index) => {
						fallbackResponse += `**${index + 1}. ${result.title}**\n`;
						fallbackResponse += `${result.content}\n\n`;
					});
				} else if (toolResult.success && toolResult.entry) {
					fallbackResponse += `**${toolResult.entry.title}**\n\n`;
					fallbackResponse += `${toolResult.entry.content}\n\n`;
				} else {
					fallbackResponse += `No results found for: "${finalTask}"\n\n`;
					if (toolResult.availableCategories) {
						fallbackResponse += `Available categories: ${toolResult.availableCategories.map(c => c.displayName).join(', ')}\n`;
					}
				}
			}
			
			if (!env.ANTHROPIC_API_KEY) {
				fallbackResponse += `\n💡 Note: API key not configured, using direct tool access.`;
			}
			
			// Save fallback response
			await saveMessage(env, finalConversationId, 'assistant', fallbackResponse);
			
			// Return simple streaming response
			const encoder = new TextEncoder();
			const stream = new ReadableStream({
				start(controller) {
					const initData = `data: ${JSON.stringify({ 
						type: 'conversation_id', 
						conversationId: finalConversationId 
					})}\n\n`;
					controller.enqueue(encoder.encode(initData));
					
					const contentData = `data: ${JSON.stringify({
						type: 'text',
						content: fallbackResponse
					})}\n\n`;
					controller.enqueue(encoder.encode(contentData));
					
					const endData = `data: ${JSON.stringify({ type: 'done' })}\n\n`;
					controller.enqueue(encoder.encode(endData));
					controller.close();
				}
			});
			
			return new Response(stream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Headers': 'Content-Type',
				},
			});
			
		} catch (fallbackError) {
			console.error('[AGENT] Fallback failed:', fallbackError);
			return new Response(JSON.stringify({ 
				error: 'Tool execution failed', 
				details: fallbackError.message 
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	try {
		
		// Create agent loop instance (only if API key is available)
		const agentLoop = new AgentLoop(env, finalTask, {
			maxIterations: Math.min(maxIterations, 3), // Max 3 iterations as requested
			maxTokensPerResult
		});

		// Run the autonomous loop
		const result = await agentLoop.runLoop();

		// Create streaming response for real-time updates
		const encoder = new TextEncoder();
		let fullResponse = '';
		
		const stream = new ReadableStream({
			start(controller) {
				// Send conversation ID first (for frontend compatibility)
				const initData = `data: ${JSON.stringify({ 
					type: 'conversation_id', 
					conversationId: finalConversationId 
				})}\n\n`;
				controller.enqueue(encoder.encode(initData));

				// Send initial status as text
				const startMessage = `🤖 Starting autonomous analysis: ${finalTask}\n\n`;
				fullResponse += startMessage;
				const startData = `data: ${JSON.stringify({
					type: 'text',
					content: startMessage
				})}\n\n`;
				controller.enqueue(encoder.encode(startData));

				// Send each iteration result
				result.results.forEach((iterationResult, index) => {
					let iterationText = `**Iteration ${index + 1}:**\n`;
					
					if (iterationResult.aiResponse) {
						iterationText += `${iterationResult.aiResponse}\n\n`;
					}
					
					// Add tool results with descriptive format
					if (iterationResult.toolResults && iterationResult.toolResults.length > 0) {
						iterationResult.toolResults.forEach(toolResult => {
							iterationText += `📊 Results from **${toolResult.toolName}** tool:\n`;
							
							if (toolResult.contextSummary) {
								iterationText += `*${toolResult.contextSummary}*\n`;
							}
							
							if (toolResult.message) {
								iterationText += `${toolResult.message}\n`;
							}
							
							if (toolResult.error) {
								iterationText += `❌ Error: ${toolResult.error}\n`;
							}
							
							iterationText += '\n';
						});
					}
					
					fullResponse += iterationText;
					
					const data = `data: ${JSON.stringify({
						type: 'text',
						content: iterationText
					})}\n\n`;
					controller.enqueue(encoder.encode(data));
				});

				// Send completion message
				const completionMessage = result.completed 
					? `✅ **Task completed** after ${result.iterations} iterations.\n\n`
					: `⏸️ **Task paused** at ${result.iterations} iterations (max reached).\n\n`;
				
				fullResponse += completionMessage;
				const completionData = `data: ${JSON.stringify({
					type: 'text',
					content: completionMessage
				})}\n\n`;
				controller.enqueue(encoder.encode(completionData));

				// Save the full response to database
				saveMessage(env, finalConversationId, 'assistant', fullResponse)
					.catch(error => console.error('Failed to save assistant message:', error));

				// End stream
				const endData = `data: ${JSON.stringify({ type: 'done' })}\n\n`;
				controller.enqueue(encoder.encode(endData));
				controller.close();
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});

	} catch (error) {
		console.error('[AGENT] Loop error:', error);
		
		// Fallback: Try simple tool execution for knowledge base queries
		if (finalTask.toLowerCase().includes('methodology') || 
		    finalTask.toLowerCase().includes('definition') ||
		    finalTask.toLowerCase().includes('what is')) {
			
			try {
				const tools = createTools(env);
				const kbResult = await tools.lookup_knowledge_base.execute({
					query: finalTask,
					detailed: true
				});
				
				let fallbackResponse = `🔍 **Simple Knowledge Base Search**\n\n`;
				if (kbResult.success && kbResult.results) {
					fallbackResponse += `Found ${kbResult.results.length} results:\n\n`;
					kbResult.results.forEach((result, index) => {
						fallbackResponse += `**${index + 1}. ${result.title}**\n`;
						fallbackResponse += `${result.content}\n\n`;
					});
				} else if (kbResult.success && kbResult.entry) {
					fallbackResponse += `**${kbResult.entry.title}**\n\n`;
					fallbackResponse += `${kbResult.entry.content}\n\n`;
				} else {
					fallbackResponse += `No results found for: "${finalTask}"\n\n`;
					if (kbResult.availableCategories) {
						fallbackResponse += `Available categories: ${kbResult.availableCategories.map(c => c.displayName).join(', ')}\n`;
					}
				}
				
				fallbackResponse += `\n⚠️ Note: Full agent loop unavailable (${error.message}). This is a basic knowledge base search.`;
				
				// Save fallback response
				await saveMessage(env, finalConversationId, 'assistant', fallbackResponse);
				
				// Return simple streaming response
				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					start(controller) {
						const initData = `data: ${JSON.stringify({ 
							type: 'conversation_id', 
							conversationId: finalConversationId 
						})}\n\n`;
						controller.enqueue(encoder.encode(initData));
						
						const contentData = `data: ${JSON.stringify({
							type: 'text',
							content: fallbackResponse
						})}\n\n`;
						controller.enqueue(encoder.encode(contentData));
						
						const endData = `data: ${JSON.stringify({ type: 'done' })}\n\n`;
						controller.enqueue(encoder.encode(endData));
						controller.close();
					}
				});
				
				return new Response(stream, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Headers': 'Content-Type',
					},
				});
				
			} catch (fallbackError) {
				console.error('[AGENT] Fallback also failed:', fallbackError);
			}
		}
		
		return new Response(JSON.stringify({ 
			error: 'Agent loop failed', 
			details: error.message 
		}), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

// Chat endpoint with streaming and tool support
export async function handleChat(env, request) {
	const { prompt, provider, model, conversationId, userId = 1, messages, enableLoop = true, maxIterations = 10 } = await request.json();

	// Support legacy 'prompt' or new 'messages' format
	const finalMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : null);

	if (!finalMessages || finalMessages.length === 0) {
		return new Response(JSON.stringify({ error: 'Missing prompt or messages' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Create or get conversation
	const finalConversationId = await createOrGetConversation(env, conversationId, userId, provider);

	// Save user message - extract content from messages array
	const userContent = finalMessages[finalMessages.length - 1]?.content || '';
	await saveMessage(env, finalConversationId, 'user', userContent);


	// Check API keys
	const selectedProvider = provider || 'anthropic';
	if (selectedProvider === 'anthropic' || selectedProvider === 'claude') {
		if (!env.ANTHROPIC_API_KEY) {
			throw new Error('ANTHROPIC_API_KEY not configured');
		}
	} else if (selectedProvider === 'groq') {
		if (!env.GROQ_API_KEY) {
			throw new Error('GROQ_API_KEY not configured');
		}
	} else if (selectedProvider === 'openai') {
		if (!env.OPENAI_API_KEY) {
			throw new Error('OPENAI_API_KEY not configured');
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
					
					console.log(`[CHAT LOOP] Starting iteration ${currentIteration}/${maxIterations}`);
					
					// Send iteration marker if looping
					if (enableLoop && currentIteration > 1) {
						console.log(`[CHAT LOOP] Sending iteration marker to client`);
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
							apiStream = await streamAnthropicResponse(env, currentMessages, SYSTEM_PROMPT, model, anthropicTools);
						} else if (selectedProvider === 'groq') {
							apiStream = await streamGroqResponse(env, currentMessages, SYSTEM_PROMPT, model, anthropicTools);
						} else if (selectedProvider === 'openai') {
							apiStream = await streamOpenAIResponse(env, currentMessages, SYSTEM_PROMPT, model, anthropicTools);
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
									fullResponse += content;
									const streamData = `data: ${JSON.stringify({ type: 'text', content })}\n\n`;
									controller.enqueue(encoder.encode(streamData));
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
										fullResponse += content;
										const streamData = `data: ${JSON.stringify({ type: 'text', content })}\n\n`;
										controller.enqueue(encoder.encode(streamData));
									}
								}
							} catch (e) {
								console.warn('Failed to parse streaming JSON data:', dataStr.substring(0, 100));
							}
						}
					}
				}

				// Process tool calls if any (filter out empty ones)
				const validToolCalls = toolCalls.filter(tc => tc && tc.name);
				if (validToolCalls.length > 0) {
					
					for (const toolCall of validToolCalls) {
						try {
							// Parse the tool input, handle empty/null cases
							let toolInput = {};
							if (toolCall.input && toolCall.input !== '{}' && toolCall.input !== 'null') {
								toolInput = JSON.parse(toolCall.input);
							}
							
							// Special handling for SQL tools that might need default queries
							if (toolCall.name === 'execute_sql' && (!toolInput.query || toolInput.query === '')) {
								// Provide a default query for demonstration
								toolInput.query = 'SELECT COUNT(*) as total_accounts FROM FRPAIR';
							}
							
							
							// Execute the tool
							const toolResult = await executeTool(toolCall.name, toolInput, tools, env);
							
							// Send tool result to client
							const toolData = `data: ${JSON.stringify({ 
								type: 'tool_result', 
								toolName: toolCall.name,
								toolInput,
								result: toolResult 
							})}\n\n`;
							controller.enqueue(encoder.encode(toolData));

							// If tool requires approval, include that in the response
							if (toolResult.requiresApproval) {
								fullResponse += `\n\n${toolResult.message}`;
							} else if (toolResult.error) {
								fullResponse += `\n\nTool error: ${toolResult.error}`;
							} else if (toolCall.name === 'complete_task' && toolResult.response) {
								// For complete_task, include the response directly in the conversation
								fullResponse += `\n\n${toolResult.response}`;
							} else if (toolResult.message) {
								fullResponse += `\n\n${toolResult.message}`;
							}

						} catch (toolError) {
							console.error('[TOOL] Error processing tool call:', toolError);
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

					// Add tool results if any
					const validToolCalls = toolCalls.filter(tc => tc && tc.name);
					if (validToolCalls.length > 0) {
						// Execute tools and get results (reusing existing tool execution logic)
						const toolResults = [];
						for (const toolCall of validToolCalls) {
							try {
								let toolInput = {};
								if (toolCall.input && toolCall.input !== '{}' && toolCall.input !== 'null') {
									toolInput = JSON.parse(toolCall.input);
								}
								
								if (toolCall.name === 'execute_sql' && (!toolInput.query || toolInput.query === '')) {
									toolInput.query = 'SELECT COUNT(*) as total_accounts FROM FRPAIR';
								}
								
								const toolResult = await executeTool(toolCall.name, toolInput, tools, env);
								toolResults.push({
									tool_call_id: toolCall.id,
									content: JSON.stringify(toolResult)
								});
							} catch (toolError) {
								toolResults.push({
									tool_call_id: toolCall.id,
									content: JSON.stringify({ error: toolError.message })
								});
							}
						}

						// Add tool results to conversation (Anthropic format)
						const smartTruncateToolResult = (result) => {
							try {
								const parsed = JSON.parse(result.content);
								
								// Handle SQL results - truncate large datasets
								if (parsed.data && Array.isArray(parsed.data)) {
									if (parsed.data.length > 10) {
										return JSON.stringify({
											...parsed,
											data: [
												...parsed.data.slice(0, 5),
												{ _truncated: `... ${parsed.data.length - 10} rows omitted ...` },
												...parsed.data.slice(-5)
											],
											_originalRowCount: parsed.data.length
										});
									}
								}
								
								// Handle other large objects - truncate long strings
								const truncated = JSON.stringify(parsed).substring(0, 4000);
								return truncated.length < JSON.stringify(parsed).length ? truncated + "..." : JSON.stringify(parsed);
								
							} catch (e) {
								// If not JSON, just truncate the string
								return result.content.length > 4000 ? result.content.substring(0, 4000) + "..." : result.content;
							}
						};

						const toolResultsContent = "TOOL RESULTS: " + toolResults.map(result => 
							`Tool ${result.tool_call_id}: ${smartTruncateToolResult(result)}`
						).join('\n\n');
						
						currentMessages.push({
							role: 'user',
							content: toolResultsContent
						});

						// Enhanced continuation logic: continue if continue_agent called OR if analysis could benefit from more depth
						const hasContinueAgent = validToolCalls.some(tc => tc.name === 'continue_agent');
						const hasCompleteTask = validToolCalls.some(tc => tc.name === 'complete_task');
						const hasAnalysisTools = validToolCalls.some(tc => ['execute_sql', 'lookup_knowledge_base', 'browse_knowledge_base_category', 'get_knowledge_base_categories'].includes(tc.name));
						
						// Continue if: continue_agent called OR (analysis tools used AND no complete_task AND under max iterations)
						shouldContinueLoop = hasContinueAgent || 
											(!hasCompleteTask && hasAnalysisTools && currentIteration < maxIterations);
						
						console.log(`[CHAT LOOP] Tool calls: ${validToolCalls.map(tc => tc.name).join(', ')}`);
						console.log(`[CHAT LOOP] Continue conditions - continue_agent: ${hasContinueAgent}, complete_task: ${hasCompleteTask}, analysis_tools: ${hasAnalysisTools}, iteration: ${currentIteration}/${maxIterations}`);
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
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': 'Content-Type',
		},
	});
}

// Get conversation history
export async function handleConversationsList(env, url) {
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

	return new Response(
		JSON.stringify({
			success: true,
			conversations: conversations.results,
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

// Get specific conversation messages
export async function handleConversationMessages(env, url) {
	const conversationId = url.pathname.split('/')[2];

	const stmt = env.DB.prepare(`
        SELECT role, content, tool_calls, created_at
        FROM conversation_messages 
        WHERE conversation_id = ? 
        ORDER BY created_at ASC
      `);
	const messages = await stmt.bind(conversationId).all();

	return new Response(
		JSON.stringify({
			success: true,
			conversationId,
			messages:
				messages.results?.map((msg) => ({
					...msg,
					tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
				})) || [],
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

// Route file operations with auth
export async function handleFileOperations(env, request, url) {
	if (!checkApiAuth(request)) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		if (url.pathname === '/files/upload' && request.method === 'POST') {
			return await handleFileUpload(env, request);
		} else if (url.pathname === '/files' && request.method === 'GET') {
			return await handleFilesList(env, url);
		} else if (url.pathname.startsWith('/files/') && request.method === 'GET') {
			return await handleFileGet(env, url);
		} else if (url.pathname.startsWith('/files/') && request.method === 'DELETE') {
			return await handleFileDelete(env, url);
		}
	} catch (error) {
		console.error('File operation error:', error);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

// Route D1 proxy with auth
export async function handleD1ProxyRoute(env, request) {
	try {
		return await handleD1Proxy(env, request);
	} catch (error) {
		console.error('D1 proxy error:', error);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}