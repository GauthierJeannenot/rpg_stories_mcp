import Anthropic from '@anthropic-ai/sdk';
import { callMcpTool } from './mcp.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: string;
}

export interface AgenticResult {
  text: string;
  toolCalls: ToolCallRecord[];
}

export async function runAgenticLoop(
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  systemPrompt: string,
): Promise<AgenticResult> {
  let current = [...messages];
  const allToolCalls: ToolCallRecord[] = [];
  let finalText = '';
  let iterations = 0;

  while (iterations < 15) {
    iterations++;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: current,
      tools,
    });

    // Collect text from this turn
    for (const block of response.content) {
      if (block.type === 'text') finalText = block.text;
    }

    if (response.stop_reason === 'end_turn') break;

    if (response.stop_reason === 'tool_use') {
      // Append assistant turn (with tool_use blocks)
      current.push({ role: 'assistant', content: response.content });

      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let resultText: string;
        try {
          resultText = await callMcpTool(block.name, block.input as Record<string, unknown>);
        } catch (e) {
          resultText = JSON.stringify({ success: false, message: String(e) });
        }

        allToolCalls.push({ name: block.name, input: block.input, result: resultText });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText });
      }

      current.push({ role: 'user', content: toolResults });
    }
  }

  return { text: finalText, toolCalls: allToolCalls };
}
