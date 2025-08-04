// Helper functions for conversation management
export async function createOrGetConversation(env, conversationId, userId, provider) {
	if (conversationId) {
		// Check if conversation exists
		const stmt = env.DB.prepare('SELECT * FROM conversations WHERE id = ?');
		const existing = await stmt.bind(conversationId).first();
		if (existing) {
			return conversationId;
		}
	}

	// Create new conversation
	const newId = conversationId || crypto.randomUUID();
	const stmt = env.DB.prepare(`
    INSERT INTO conversations (id, user_id, model, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
  `);
	await stmt.bind(newId, userId, provider || 'groq').run();
	return newId;
}

export async function saveMessage(env, conversationId, role, content, toolCalls = null) {
	const stmt = env.DB.prepare(`
    INSERT INTO conversation_messages (conversation_id, role, content, tool_calls, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
	await stmt.bind(conversationId, role, content, toolCalls ? JSON.stringify(toolCalls) : null).run();
}