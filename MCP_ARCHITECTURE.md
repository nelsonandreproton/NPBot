# MCP Bot Architecture

This bot integrates Multiple MCP (Model Context Protocol) servers with intelligent LLM-based routing and dynamic result formatting.

## Key Features

### 1. Dynamic MCP Server Discovery
- Reads `mcp_config.json` to discover configured MCP servers
- Automatically loads and connects to available servers
- Discovers available tools from each server
- Gracefully handles server connection failures with fallback

### 2. LLM-Based Tool Selection
Instead of hardcoded routing logic, the system uses the LLM to:
- Analyze user queries
- Select the most appropriate MCP server and tool
- Extract parameters intelligently from natural language
- Decide when no MCP tool is needed

### 3. Dynamic Result Formatting
- Uses LLM to format results in a user-friendly way
- Adapts to any type of MCP server response
- No hardcoded formatting rules
- Automatically adds appropriate emojis and markdown

### 4. Robust Fallback System
- If MCP tool selection fails → Falls back to direct LLM response
- If MCP tool execution fails → Falls back to direct LLM response  
- If LLM tool selection fails → Falls back to direct LLM response

## Architecture Flow

1. **Startup**: Bot initializes MCP servers from config
2. **User Query**: User sends `@np [query]`
3. **LLM Analysis**: System asks LLM to analyze query and available tools
4. **Tool Selection**: LLM decides which tool to use (if any) and extracts parameters
5. **Execution**: If tool selected, execute MCP tool; otherwise use direct LLM
6. **Formatting**: LLM formats the result in user-friendly way
7. **Response**: Send formatted result to user

## Configuration

### Adding New MCP Servers
Simply add new servers to `mcp_config.json`:

```json
{
  "mcpServers": {
    "your-new-server": {
      "command": "your-command",
      "args": ["arg1", "arg2"]
    }
  }
}
```

The system will automatically:
- Discover the new server
- Load its available tools
- Include it in LLM tool selection
- Format its results appropriately

### No Code Changes Required
- Tool selection is handled by LLM prompt engineering
- Result formatting adapts to any response structure
- Parameter extraction works for any tool schema

## Commands

- `/mcp` - Show status of all MCP servers and their tools
- `/reset` - Reset conversation state
- `/runtime` - Show runtime information

## Benefits

1. **Extensible**: Add new MCP servers without code changes
2. **Intelligent**: LLM makes smart routing decisions
3. **Adaptive**: Dynamic formatting for any response type
4. **Robust**: Multiple fallback layers ensure reliability
5. **User-Friendly**: Natural language interaction with technical tools

## Files

- `mcpManager.js` - MCP server management and tool discovery
- `teamsBot.js` - Main bot logic with LLM integration
- `mcp_config.json` - MCP server configuration
- `test-llm-selection.js` - Testing utilities