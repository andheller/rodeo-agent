import { createTools } from '../tools.js';

// Convert Zod schema to JSON schema for API documentation
function convertZodSchemaToJson(zodSchema) {
	if (!zodSchema || !zodSchema._def) {
		return { type: 'object' };
	}

	// Handle ZodObject type
	if (zodSchema._def.typeName === 'ZodObject') {
		const shape = zodSchema._def.shape;
		if (!shape) {
			return { type: 'object' };
		}

		const properties = {};
		const required = [];

		for (const [key, value] of Object.entries(shape)) {
			if (value._def) {
				properties[key] = {
					type: getZodType(value._def),
					description: value._def.description || ''
				};
				
				// Check if field is required (not optional)
				if (value._def.typeName !== 'ZodOptional') {
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

	return { type: 'object' };
}

// Get JSON schema type from Zod type
function getZodType(zodDef) {
	if (zodDef.typeName === 'ZodString') return 'string';
	if (zodDef.typeName === 'ZodNumber') return 'number';
	if (zodDef.typeName === 'ZodBoolean') return 'boolean';
	if (zodDef.typeName === 'ZodArray') return 'array';
	if (zodDef.typeName === 'ZodObject') return 'object';
	if (zodDef.typeName === 'ZodRecord') return 'object';
	return 'string';
}

// Handle GET /tools - List available tools and their schemas
export async function handleToolsList(env) {
	try {
		const tools = createTools(env);
		const toolsInfo = {};

		for (const [name, tool] of Object.entries(tools)) {
			// Try to get a better schema representation
			let schema;
			try {
				schema = convertZodSchemaToJson(tool.inputSchema);
				
				// If conversion failed, try direct access to shape
				if (!schema.properties || Object.keys(schema.properties).length === 0) {
					if (tool.inputSchema._def && tool.inputSchema._def.shape) {
						const properties = {};
						const required = [];
						
						for (const [key, value] of Object.entries(tool.inputSchema._def.shape)) {
							if (value.description) {
								properties[key] = {
									type: 'string', // Default type
									description: value.description
								};
								required.push(key);
							}
						}
						
						schema = { type: 'object', properties, required };
					}
				}
			} catch (e) {
				schema = { type: 'object', error: e.message };
			}
			
			toolsInfo[name] = {
				name: name,
				description: tool.description,
				inputSchema: schema
			};
		}

		return new Response(
			JSON.stringify({
				success: true,
				tools: toolsInfo,
				totalTools: Object.keys(toolsInfo).length,
				usage: {
					listTools: "GET /tools",
					executeTool: "POST /tools with {\"tool\": \"tool_name\", \"arguments\": {...}}"
				}
			}, null, 2),
			{
				headers: { 'Content-Type': 'application/json' }
			}
		);
	} catch (error) {
		console.error('Tools list error:', error);
		return new Response(
			JSON.stringify({
				success: false,
				error: `Failed to list tools: ${error.message}`
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
}

// Handle POST /tools - Execute a specific tool
export async function handleToolExecution(env, request) {
	try {
		const body = await request.json();
		
		// Validate request format
		if (!body || typeof body !== 'object') {
			return new Response(
				JSON.stringify({
					success: false,
					error: 'Request body must be a JSON object'
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}

		const { tool: toolName, arguments: toolArgs } = body;

		// Validate required fields
		if (!toolName || typeof toolName !== 'string') {
			return new Response(
				JSON.stringify({
					success: false,
					error: 'Missing or invalid "tool" field. Must be a string.'
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}

		if (!toolArgs || typeof toolArgs !== 'object') {
			return new Response(
				JSON.stringify({
					success: false,
					error: 'Missing or invalid "arguments" field. Must be an object.'
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}

		// Get available tools
		const tools = createTools(env);

		// Check if tool exists
		if (!tools[toolName]) {
			const availableTools = Object.keys(tools);
			return new Response(
				JSON.stringify({
					success: false,
					error: `Tool "${toolName}" not found`,
					availableTools: availableTools
				}),
				{
					status: 404,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}

		const tool = tools[toolName];

		// Validate arguments against schema
		try {
			tool.inputSchema.parse(toolArgs);
		} catch (validationError) {
			return new Response(
				JSON.stringify({
					success: false,
					error: 'Invalid arguments for tool',
					details: validationError.errors || validationError.message,
					expectedSchema: convertZodSchemaToJson(tool.inputSchema)
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}

		// Execute the tool
		const startTime = Date.now();
		const result = await tool.execute(toolArgs);
		const executionTime = Date.now() - startTime;

		// Return successful result
		return new Response(
			JSON.stringify({
				success: true,
				tool: toolName,
				arguments: toolArgs,
				result: result,
				executionTime: `${executionTime}ms`
			}, null, 2),
			{
				headers: { 'Content-Type': 'application/json' }
			}
		);

	} catch (error) {
		console.error('Tool execution error:', error);
		return new Response(
			JSON.stringify({
				success: false,
				error: `Tool execution failed: ${error.message}`,
				stack: error.stack
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
}