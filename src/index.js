import { Agent } from "agents";
import { runWithTools } from "@cloudflare/ai-utils";
import { tools } from "./tools.js";

export class MathAgent extends Agent {
  async onMessage(conn, raw) {
    const { prompt } = JSON.parse(raw);
    const stream = await runWithTools({
      ai: this.env.AI,
      model: this.env.MODEL ?? "@cf/meta/llama-3-8b-instruct",
      messages: [{ role: "user", content: prompt }],
      tools,
      stream: true
    });

    for await (const chunk of stream) {
      conn.send(JSON.stringify(chunk));
    }
  }
}

async function fetch(request, env) {
  const url = new URL(request.url);
  
  if (url.pathname === "/") {
    return new Response(JSON.stringify({
      status: "ok",
      message: "Rodeo AI Agent",
      endpoints: ["/", "/chat"]
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  if (url.pathname === "/chat" && request.method === "POST") {
    try {
      const { prompt } = await request.json();
      
      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing prompt" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const response = await runWithTools(
        env.AI,
        "@hf/nousresearch/hermes-2-pro-mistral-7b",
        {
          messages: [{ role: "user", content: prompt }],
          tools
        },
        {
          verbose: true,
          maxRecursiveToolRuns: 5
        }
      );

      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
}

function connect(websocket) {
  const agent = new MathAgent();
  return agent.connect(websocket);
}

export default { fetch, connect };
