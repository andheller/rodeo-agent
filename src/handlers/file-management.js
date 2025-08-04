// File upload handler
export async function handleFileUpload(env, request) {
	const formData = await request.formData();
	const file = formData.get('file');
	const userId = formData.get('userId');

	if (!file || !userId) {
		return new Response(JSON.stringify({ error: 'Missing file or userId' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Generate unique R2 key
	const timestamp = Date.now();
	const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
	const r2Key = `user-${userId}/${timestamp}-${sanitizedFilename}`;

	// Upload to R2
	await env.R2.put(r2Key, file);

	// Store metadata in D1
	const stmt = env.DB.prepare(`
        INSERT INTO files (user_id, filename, original_filename, size, mime_type, r2_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

	const result = await stmt
		.bind(parseInt(userId), sanitizedFilename, file.name, file.size, file.type || 'application/octet-stream', r2Key)
		.run();

	return new Response(
		JSON.stringify({
			success: true,
			file: {
				id: result.meta.last_row_id,
				filename: sanitizedFilename,
				originalFilename: file.name,
				size: file.size,
				mimeType: file.type,
				r2Key: r2Key,
			},
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

// File list handler
export async function handleFilesList(env, url) {
	const userId = url.searchParams.get('userId');
	if (!userId) {
		return new Response(JSON.stringify({ error: 'Missing userId' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const stmt = env.DB.prepare(`
        SELECT id, filename, original_filename, size, mime_type, r2_key, upload_time, last_accessed
        FROM files
        WHERE user_id = ?
        ORDER BY upload_time DESC
      `);

	const result = await stmt.bind(parseInt(userId)).all();

	return new Response(
		JSON.stringify({
			success: true,
			files: result.results,
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

// File get handler
export async function handleFileGet(env, url) {
	const fileId = url.pathname.split('/')[2];
	const action = url.searchParams.get('action');

	// Get file metadata from D1
	const stmt = env.DB.prepare(`
        SELECT * FROM files WHERE id = ?
      `);
	const result = await stmt.bind(parseInt(fileId)).first();

	if (!result) {
		return new Response(JSON.stringify({ error: 'File not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Update last accessed time
	await env.DB.prepare(
		`
        UPDATE files SET last_accessed = datetime('now') WHERE id = ?
      `
	)
		.bind(parseInt(fileId))
		.run();

	if (action === 'download') {
		// Get file from R2 and return it
		const object = await env.R2.get(result.r2_key);
		if (!object) {
			return new Response(JSON.stringify({ error: 'File not found in storage' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		return new Response(object.body, {
			headers: {
				'Content-Type': result.mime_type,
				'Content-Disposition': `attachment; filename="${result.original_filename}"`,
			},
		});
	} else {
		// Return file metadata with signed URL
		const signedUrl = await env.R2.createSignedUrl(result.r2_key, {
			expiresIn: 3600, // 1 hour
		});

		return new Response(
			JSON.stringify({
				success: true,
				file: result,
				signedUrl,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

// File delete handler
export async function handleFileDelete(env, url) {
	const fileId = url.pathname.split('/')[2];

	// Get file metadata from D1
	const stmt = env.DB.prepare(`
        SELECT r2_key FROM files WHERE id = ?
      `);
	const result = await stmt.bind(parseInt(fileId)).first();

	if (!result) {
		return new Response(JSON.stringify({ error: 'File not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Delete from R2
	await env.R2.delete(result.r2_key);

	// Delete from D1
	await env.DB.prepare(
		`
        DELETE FROM files WHERE id = ?
      `
	)
		.bind(parseInt(fileId))
		.run();

	return new Response(
		JSON.stringify({
			success: true,
			message: 'File deleted successfully',
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}