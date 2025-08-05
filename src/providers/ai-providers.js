// Model name mapping for Anthropic
function anthropicModelId(name) {
	if (!name) return 'claude-3-5-haiku-latest'; // default to haiku
	if (name === 'haiku') return 'claude-3-5-haiku-latest';
	if (name === 'sonnet') return 'claude-sonnet-4-20250514';
	// allow full API names through unchanged
	return name;
}

// Direct API streaming functions
export async function streamAnthropicResponse(env, messages, systemPrompt, modelName, tools = null) {
	// Handle both old string format and new array format for system prompt
	const systemConfig = Array.isArray(systemPrompt) ? systemPrompt : [
		{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
	];
	
	const requestBody = {
		model: anthropicModelId(modelName),
		max_tokens: 4096,
		messages: messages,
		system: systemConfig,  // Now uses array format with caching support
		stream: true,
	};

	// Add tools if provided
	if (tools && Array.isArray(tools) && tools.length > 0) {
		requestBody.tools = tools;
	}


	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': env.ANTHROPIC_API_KEY,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify(requestBody),
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error('[API] Anthropic API error response:', errorText);
		throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	return response.body;
}

export async function streamGroqResponse(env, messages, systemPrompt, modelName, tools = null) {
	
	const requestBody = {
		model: modelName || env.GROQ_MODEL || 'openai/gpt-oss-120b',
		messages: [{ role: 'system', content: systemPrompt }, ...messages],
		stream: true,
	};

	// Add tools if provided (OpenAI-compatible format)
	if (tools && Array.isArray(tools) && tools.length > 0) {
		requestBody.tools = tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema
			}
		}));
	}


	const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.GROQ_API_KEY}`,
		},
		body: JSON.stringify(requestBody),
	});


	if (!response.ok) {
		const errorText = await response.text();
		console.error('❌ Groq API Error:', errorText);
		throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
	}

	return response.body;
}

export async function streamOpenAIResponse(env, messages, systemPrompt, modelName, tools = null) {
	const requestBody = {
		model: modelName || env.OPENAI_MODEL || 'gpt-4o-mini',
		messages: [{ role: 'system', content: systemPrompt }, ...messages],
		stream: true,
	};

	// Add tools if provided (OpenAI format)
	if (tools && Array.isArray(tools) && tools.length > 0) {
		requestBody.tools = tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema
			}
		}));
	}

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
		},
		body: JSON.stringify(requestBody),
	});

	if (!response.ok) {
		throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
	}

	return response.body;
}