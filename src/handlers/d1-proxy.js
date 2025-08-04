// D1 proxy configuration
const D1_PROXY_API_KEY = 'secret123';

export async function handleD1Proxy(env, request) {
	// Check API key authentication
	const apiKey = request.headers.get('x-api-key');
	if (!apiKey || apiKey !== D1_PROXY_API_KEY) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const { query, params = [] } = await request.json();

	if (!query) {
		return new Response(JSON.stringify({ error: 'Missing query' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Check if it's a command (INSERT, UPDATE, DELETE) or query (SELECT)
	const isCommand = query.startsWith('COMMAND:');
	const actualQuery = isCommand ? query.substring(8) : query;

	try {
		const stmt = env.DB.prepare(actualQuery);
		let result;

		if (isCommand) {
			// Use run() for commands
			result = params.length > 0 ? await stmt.bind(...params).run() : await stmt.run();
		} else {
			// Use all() for queries
			result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
		}

		return new Response(JSON.stringify(result), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (dbError) {
		console.error('D1 proxy database error:', dbError);
		return new Response(JSON.stringify({ error: `Database error: ${dbError.message}` }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}