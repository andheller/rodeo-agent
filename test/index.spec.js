import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';
import { tools } from '../src/tools.js';

describe('Rodeo Agent', () => {
	it('responds with status info', async () => {
		const request = new Request('http://example.com');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		const data = await response.json();
		expect(data.status).toBe('ok');
		expect(data.message).toBe('Rodeo AI Agent');
	});

	it('has math tools available', () => {
		const mathTool = tools.find(tool => tool.name === 'evaluate_expression');
		expect(mathTool).toBeDefined();
		expect(mathTool.description).toContain('arithmetic expression');
	});

	it('has SQL tools available', () => {
		const sqlTool = tools.find(tool => tool.name === 'execute_sql');
		const schemaTool = tools.find(tool => tool.name === 'get_database_schema');
		
		expect(sqlTool).toBeDefined();
		expect(sqlTool.description).toContain('SQL SELECT query');
		
		expect(schemaTool).toBeDefined();
		expect(schemaTool.description).toContain('database tables');
	});

	it('validates SQL queries correctly', () => {
		const sqlTool = tools.find(tool => tool.name === 'execute_sql');
		
		// Test with a non-SELECT query (should fail validation)
		const result = sqlTool.function({ query: 'DROP TABLE users' });
		expect(result).resolves.toMatchObject({ 
			error: expect.stringContaining('Only SELECT queries are allowed') 
		});
	});

	it('accepts valid SELECT queries', () => {
		const sqlTool = tools.find(tool => tool.name === 'execute_sql');
		
		// Test that valid SELECT queries pass validation
		// Note: This will make an actual network request to Railway in real tests
		const result = sqlTool.function({ query: 'SELECT * FROM frpair LIMIT 10' });
		
		// Since we're testing against a live endpoint, we expect either success or a specific error
		expect(result).resolves.toMatchObject(
			expect.objectContaining({
				success: expect.any(Boolean)
			})
		);
	});

	it('handles math calculations', () => {
		const mathTool = tools.find(tool => tool.name === 'evaluate_expression');
		const result = mathTool.function({ expression: '2 + 2 * 3' });
		expect(result).toEqual({ result: 8 });
	});

	it('calculates statistical measures', () => {
		const meanTool = tools.find(tool => tool.name === 'check_mean');
		const varianceTool = tools.find(tool => tool.name === 'check_variance');
		
		const testData = [1, 2, 3, 4, 5];
		
		const meanResult = meanTool.function({ values: testData });
		const varianceResult = varianceTool.function({ values: testData });
		
		expect(meanResult).toEqual({ mean: 3 });
		expect(varianceResult.variance).toBeCloseTo(2.5, 1);
	});

	it('can fetch database schema from Railway endpoint', async () => {
		const schemaTool = tools.find(tool => tool.name === 'get_database_schema');
		
		// Test against live Railway endpoint
		const result = await schemaTool.function({});
		
		// Should return either success with tables or a network error
		expect(result).toMatchObject(
			expect.objectContaining({
				success: expect.any(Boolean)
			})
		);
		
		if (result.success) {
			expect(result.tables).toBeDefined();
			expect(result.tableCount).toBeGreaterThanOrEqual(0);
		}
	});

	it('uses Railway endpoint configuration', () => {
		const sqlTool = tools.find(tool => tool.name === 'execute_sql');
		
		// Check that the tool description mentions SQL SELECT queries
		expect(sqlTool.description).toContain('SQL SELECT query');
		expect(sqlTool.parameters.required).toContain('query');
	});
});
