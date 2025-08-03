// Database abstraction layer for D1 and DuckDB
// D1 for agent data, DuckDB for FRP financial data

class DatabaseManager {
  constructor(d1Database = null, duckdbConfig = null) {
    this.d1 = d1Database;
    this.duckdb = duckdbConfig || {
      url: 'https://frai-duckdb-api-production.up.railway.app/query',
      apiKey: 'secret123'
    };
  }

  // D1 Operations (Agent Data)
  async executeD1Query(query, params = []) {
    if (!this.d1) {
      throw new Error('D1 database not available');
    }
    
    try {
      const stmt = this.d1.prepare(query);
      const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
      return result;
    } catch (error) {
      console.error('D1 query error:', error);
      throw error;
    }
  }

  // DuckDB Operations (FRP Financial Data)
  async executeDuckDBQuery(query) {
    try {
      const response = await fetch(this.duckdb.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.duckdb.apiKey
        },
        body: JSON.stringify({ sql: query, source: 'duckdb' })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      return Array.isArray(result) ? result : result.data || result.rows || [];
    } catch (error) {
      console.error('DuckDB query error:', error);
      throw error;
    }
  }

  // User Management (D1)
  async createUser(username, hashedPassword, role = 'user') {
    return await this.executeD1Query(
      'INSERT INTO users (username, hashed_password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role]
    );
  }

  async getUserByUsername(username) {
    const result = await this.executeD1Query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return result.results.length > 0 ? result.results[0] : null;
  }

  async getUserById(id) {
    const result = await this.executeD1Query(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    return result.results.length > 0 ? result.results[0] : null;
  }

  async updateUser(id, updates) {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    return await this.executeD1Query(
      `UPDATE users SET ${setClause} WHERE id = ?`,
      [...values, id]
    );
  }

  async deleteUser(id) {
    return await this.executeD1Query(
      'DELETE FROM users WHERE id = ?',
      [id]
    );
  }

  // Report Configuration Management (D1)
  async createReportConfig(label, queryTemplate, columnDefinitions, parameterDefinitions) {
    return await this.executeD1Query(
      'INSERT INTO report_configurations (label, query_template, column_definitions, parameter_definitions) VALUES (?, ?, ?, ?)',
      [label, queryTemplate, columnDefinitions, parameterDefinitions]
    );
  }

  async getReportConfigs() {
    const result = await this.executeD1Query('SELECT * FROM report_configurations ORDER BY label');
    return result.results;
  }

  async getReportConfigById(id) {
    const result = await this.executeD1Query(
      'SELECT * FROM report_configurations WHERE id = ?',
      [id]
    );
    return result.results.length > 0 ? result.results[0] : null;
  }

  async updateReportConfig(id, updates) {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    return await this.executeD1Query(
      `UPDATE report_configurations SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...values, id]
    );
  }

  async deleteReportConfig(id) {
    return await this.executeD1Query(
      'DELETE FROM report_configurations WHERE id = ?',
      [id]
    );
  }

  // Agentic Workflow Management (D1)
  async createWorkflow(name, description, workflowData, status = 'active') {
    return await this.executeD1Query(
      'INSERT INTO agentic_workflows (name, description, workflow_data, status) VALUES (?, ?, ?, ?)',
      [name, description, workflowData, status]
    );
  }

  async getWorkflows() {
    const result = await this.executeD1Query('SELECT * FROM agentic_workflows ORDER BY name');
    return result.results;
  }

  async getWorkflowById(id) {
    const result = await this.executeD1Query(
      'SELECT * FROM agentic_workflows WHERE id = ?',
      [id]
    );
    return result.results.length > 0 ? result.results[0] : null;
  }

  async updateWorkflow(id, updates) {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    return await this.executeD1Query(
      `UPDATE agentic_workflows SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...values, id]
    );
  }

  async deleteWorkflow(id) {
    return await this.executeD1Query(
      'DELETE FROM agentic_workflows WHERE id = ?',
      [id]
    );
  }

  // Financial Data Operations (DuckDB)
  async getPortfolioData(accountId = null) {
    let query = 'SELECT * FROM FRPAIR';
    if (accountId) {
      query += ` WHERE ACCT = '${accountId}'`;
    }
    return await this.executeDuckDBQuery(query);
  }

  async getHoldingsData(accountId = null) {
    let query = 'SELECT * FROM FRPHOLD';
    if (accountId) {
      query += ` WHERE ACCT = '${accountId}'`;
    }
    return await this.executeDuckDBQuery(query);
  }

  async getSecuritiesData(securityId = null) {
    let query = 'SELECT * FROM FRPSEC';
    if (securityId) {
      query += ` WHERE SECID = '${securityId}'`;
    }
    return await this.executeDuckDBQuery(query);
  }

  async getTransactionsData(accountId = null) {
    let query = 'SELECT * FROM FRPTRAN';
    if (accountId) {
      query += ` WHERE ACCT = '${accountId}'`;
    }
    return await this.executeDuckDBQuery(query);
  }

  // Generic query execution
  async executeFinancialQuery(query) {
    return await this.executeDuckDBQuery(query);
  }

  async executeAgentQuery(query, params = []) {
    return await this.executeD1Query(query, params);
  }
}

export default DatabaseManager;