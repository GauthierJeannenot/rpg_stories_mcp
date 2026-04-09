import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = path.join(__dirname, '../../dist/index.js');

let _client: Client | null = null;

export async function getMcpClient(): Promise<Client> {
  if (_client) return _client;

  _client = new Client(
    { name: 'rpg-stories-backend', version: '1.0.0' },
    { capabilities: {} },
  );

  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_SERVER_PATH],
  });

  await _client.connect(transport);
  return _client;
}

// MCP tool definition → Anthropic tool definition
export async function getAnthropicTools() {
  const client = await getMcpClient();
  const { tools } = await client.listTools();
  return tools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as Record<string, unknown>,
  }));
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const client = await getMcpClient();
  const result = await client.callTool({ name, arguments: args });
  const first = (result.content as { type: string; text?: string }[])[0];
  return first?.text ?? '{}';
}

export async function readMcpResource(uri: string): Promise<string> {
  const client = await getMcpClient();
  const result = await client.readResource({ uri });
  return (result.contents[0] as { text: string }).text ?? '{}';
}

export async function getMcpPrompt(name: string): Promise<string> {
  const client = await getMcpClient();
  const result = await client.getPrompt({ name });
  const first = result.messages[0];
  if (!first) return '';
  const content = first.content;
  return typeof content === 'string' ? content : (content as { text: string }).text ?? '';
}
