# Rodeo AI Agent

A Cloudflare Workers AI agent that provides math calculation tools via HTTP and WebSocket connections.

## Features

- **HTTP Endpoints**: REST API for AI chat with math tools
- **WebSocket Support**: Real-time streaming responses via Rodeo agent framework
- **Math Tools**: Arithmetic expressions, statistical functions (mean, variance)
- **Function Calling**: Uses embedded function calling with mathjs library

## API Endpoints

### GET /
Returns status information and available endpoints.

```bash
curl https://rodeo-agent.dashing.workers.dev/
```

### POST /chat
AI chat endpoint with math tool support.

**Request:**
```json
{
  "prompt": "Calculate 123 * 456"
}
```

**Response:**
```json
{
  "response": "The result of 123 * 456 is 56088.",
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

### GET /readme
Returns inline usage documentation.

## Examples

### Basic Math
```bash
curl -X POST https://rodeo-agent.dashing.workers.dev/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 25 * 4 + 10?"}'
```

### Complex Expressions
```bash
curl -X POST https://rodeo-agent.dashing.workers.dev/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Calculate sin(45) + cos(60) * tan(30)"}'
```

### Statistical Functions
```bash
curl -X POST https://rodeo-agent.dashing.workers.dev/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is the mean of [1, 2, 3, 4, 5]?"}'
```

## Available Math Tools

- **evaluate_expression**: Evaluate numeric arithmetic expressions
- **check_mean**: Calculate arithmetic mean of an array of numbers
- **check_variance**: Calculate sample variance of an array of numbers

## Development

### Local Development
```bash
npm run dev
```

### Deploy
```bash
npm run deploy
```

### Test
```bash
npm test
```

## Technical Details

- **Runtime**: Cloudflare Workers
- **AI Model**: Hermes-2-Pro-Mistral-7B (function calling compatible)
- **Framework**: Rodeo agent framework for WebSocket support
- **Math Library**: mathjs for expression evaluation
- **Function Calling**: @cloudflare/ai-utils with embedded function calling

## WebSocket Usage

The agent also supports WebSocket connections for streaming responses:

```javascript
const ws = new WebSocket('wss://rodeo-agent.dashing.workers.dev/');
ws.send(JSON.stringify({ prompt: "Calculate 2+2" }));
```