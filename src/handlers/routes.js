import { createOrGetConversation, saveMessage } from '../utils/conversation.js';
import { handleD1Proxy } from './d1-proxy.js';
import { handleFileUpload, handleFilesList, handleFileGet, handleFileDelete } from './file-management.js';

// Authentication helper
function checkApiAuth(request) {
	const apiKey = request.headers.get('x-api-key');
	return apiKey && apiKey === 'secret123';
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

