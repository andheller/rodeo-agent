/**
 * Centralized configuration for AI-related functionality
 */

export const AI_CONFIG = {
	// Model configurations
	DEFAULT_MODELS: {
		anthropic: 'claude-3-5-haiku-latest',
		claude: 'claude-3-5-haiku-latest',
		groq: 'openai/gpt-oss-120b', // Default groq model
		'groq-20b': 'openai/gpt-oss-20b', // Specific GPT-OSS 20B model
		'groq-120b': 'openai/gpt-oss-120b', // Specific GPT-OSS 120B model
		openai: 'gpt-4-turbo-preview',
		gemini: 'claude-3-5-haiku-latest', // Rerouted to Claude Haiku
		grader: 'claude-3-5-haiku-latest'
	},

	// Agent loop settings
	AGENT_LOOP: {
		MAX_ITERATIONS: 10,
		DEFAULT_MAX_ITERATIONS: 3, // As requested in original code
		MAX_TOKENS_PER_RESULT: 1500,
		DEFAULT_MAX_TOKENS: 1500
	},

	// Chat loop settings
	CHAT_LOOP: {
		MAX_ITERATIONS: 10,
		ENABLE_LOOP_DEFAULT: true
	},

	// Data truncation limits
	TRUNCATION_LIMITS: {
		SQL_ROWS_PREVIEW: 10,          // Rows to show in preview (5 first + 5 last)
		SQL_ROWS_DISPLAY: 5,           // Rows to show at start/end when truncating
		CONTENT_LENGTH: 4000,          // Max content length before truncation
		CONTENT_PREVIEW_LENGTH: 3800,  // Length to truncate to
		TOOL_RESULT_LENGTH: 4000,      // Max tool result length
		JSON_INDENT: 2                 // JSON formatting indent
	},

	// API settings
	API_SETTINGS: {
		ANTHROPIC_VERSION: '2023-06-01',
		OPENAI_API_URL: 'https://api.openai.com/v1/chat/completions',
		GROQ_API_URL: 'https://api.groq.com/openai/v1/chat/completions',
		ANTHROPIC_API_URL: 'https://api.anthropic.com/v1/messages'
	},

	// Grader settings
	GRADER: {
		MAX_TOKENS: 1000,
		STOP_SEQUENCES: ['```']
	},

	// Streaming settings
	STREAMING: {
		HEADERS: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': 'Content-Type'
		}
	},

	// Tool execution settings
	TOOL_EXECUTION: {
		DEFAULT_SQL_QUERY: 'SELECT COUNT(*) as total_accounts FROM FRPAIR', // Fallback for empty queries
		CONTINUE_ON_ANALYSIS_TOOLS: ['execute_sql', 'lookup_knowledge_base', 'browse_knowledge_base_category', 'get_knowledge_base_categories'],
		DEFAULT_TIMEOUT: 30000, // 30 seconds default timeout
		SQL_TIMEOUT: 45000,     // 45 seconds for SQL queries
		BATCH_TIMEOUT: 60000,   // 60 seconds for batch operations
		KB_TIMEOUT: 15000       // 15 seconds for knowledge base searches
	},

	// Error codes
	ERROR_CODES: {
		MISSING_INPUT: 'MISSING_INPUT',
		API_KEY_MISSING: 'API_KEY_MISSING',
		API_ERROR: 'API_ERROR',
		TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
		TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',
		PARSING_ERROR: 'PARSING_ERROR',
		STREAMING_ERROR: 'STREAMING_ERROR',
		VALIDATION_ERROR: 'VALIDATION_ERROR',
		LOOP_ERROR: 'LOOP_ERROR',
		// Enhanced error codes
		TOOL_TIMEOUT: 'TOOL_TIMEOUT',
		PARALLEL_BATCH_PARTIAL_FAILURE: 'PARALLEL_BATCH_PARTIAL_FAILURE',
		KNOWLEDGE_BASE_CONNECTION_ERROR: 'KNOWLEDGE_BASE_CONNECTION_ERROR',
		SQL_SYNTAX_ERROR: 'SQL_SYNTAX_ERROR',
		DATABASE_CONNECTION_ERROR: 'DATABASE_CONNECTION_ERROR'
	},

	// Logging settings
	LOGGING: {
		ENABLE_TOOL_LOGGING: true,
		ENABLE_LOOP_LOGGING: true,
		LOG_PREFIXES: {
			TOOL: '[TOOL]',
			CHAT_LOOP: '[CHAT LOOP]',
			AGENT: '[AGENT]',
			STREAM: '[STREAM]',
			GRADER: '[GRADER]',
			ERROR: '[ERROR]'
		}
	}
};

// Helper function to get model for provider
export function getModelForProvider(provider, modelOverride = null) {
	if (modelOverride) return modelOverride;
	return AI_CONFIG.DEFAULT_MODELS[provider] || AI_CONFIG.DEFAULT_MODELS.anthropic;
}

// Helper function to format log message
export function formatLogMessage(prefix, message, data = null) {
	const logMessage = `${prefix} ${message}`;
	if (data) {
		console.log(logMessage, data);
	} else {
		console.log(logMessage);
	}
}

// Helper function to create timeout wrapper for tool execution
export function withTimeout(promise, timeoutMs, toolName = 'unknown') {
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Tool '${toolName}' timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		})
	]);
}