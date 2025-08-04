import {
	handleTestFetch,
	handleChat,
	handleAgent,
	handleConversationsList,
	handleConversationMessages,
	handleFileOperations,
	handleD1ProxyRoute
} from './handlers/routes.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		try {
			// Test fetch endpoint
			if (url.pathname === '/test-fetch' && request.method === 'GET') {
				return await handleTestFetch();
			}

			// D1 proxy endpoint
			if (url.pathname === '/d1-proxy' && request.method === 'POST') {
				return await handleD1ProxyRoute(env, request);
			}

			// File operations endpoints
			if (url.pathname.startsWith('/files')) {
				return await handleFileOperations(env, request, url);
			}

			// Chat endpoint
			if (url.pathname === '/chat' && request.method === 'POST') {
				return await handleChat(env, request);
			}


			// Conversation endpoints
			if (url.pathname === '/conversations' && request.method === 'GET') {
				return await handleConversationsList(env, url);
			}

			if (url.pathname.startsWith('/conversations/') && request.method === 'GET') {
				return await handleConversationMessages(env, url);
			}

			// 404 for unmatched routes
			return new Response(JSON.stringify({ error: 'Not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Request handling error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	},
};