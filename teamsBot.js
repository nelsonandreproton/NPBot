require('dotenv').config();
const { ActivityTypes } = require("@microsoft/agents-activity");
const {
  AgentApplication,
  AttachmentDownloader,
  MemoryStorage,
} = require("@microsoft/agents-hosting");
const { version } = require("@microsoft/agents-hosting/package.json");
const LazyMCPManager = require("./mcpManagerLazy");

const downloader = new AttachmentDownloader();

// Define storage and application
const storage = new MemoryStorage();
const teamsBot = new AgentApplication({
  storage,
  fileDownloaders: [downloader],
});

// Initialize Lazy MCP Manager (no startup connection)
const mcpManager = new LazyMCPManager();
console.log('MCP Manager ready - servers will be connected on demand');

async function processUserQuery(context, query) {
  console.log(`Processing query: ${query}`);
  
  let toolSelectionResponse = null;
  
  try {
    // Step 1: Get available servers (without connecting)
    const availableServers = mcpManager.getAvailableServers();
    
    if (availableServers.length > 0) {
      // Step 2: Ask LLM to select which server to use
      const serverSelectionResponse = await queryOllamaForServerSelection(query, availableServers);
      
      if (serverSelectionResponse && serverSelectionResponse.useServer) {
        console.log(`LLM selected server: ${serverSelectionResponse.serverName}`);
        
        // Step 3: Connect to selected server and get its tools
        const availableTools = await mcpManager.getToolsFromServer(serverSelectionResponse.serverName);
        
        // Step 4: Ask LLM to decide which tool to use from the selected server
        toolSelectionResponse = await queryOllamaForToolSelection(query, availableTools);
        
        if (toolSelectionResponse && toolSelectionResponse.usesTool) {
          console.log(`LLM selected: ${toolSelectionResponse.serverName}:${toolSelectionResponse.toolName}`);
          
          await context.sendActivity(`🔍 Using ${toolSelectionResponse.serverName} (${toolSelectionResponse.toolName})`);
          
          // Execute the MCP tool with LLM-extracted parameters
          const result = await mcpManager.executeServerTool(
            toolSelectionResponse.serverName,
            toolSelectionResponse.toolName,
            toolSelectionResponse.parameters
          );
          
          // Format and send the result
          const formattedResult = await formatMCPResultWithLLM(result, toolSelectionResponse.toolName, query);
          
          // Ensure we send a string, not an object or array
          const resultText = typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult);
          await context.sendActivity(resultText);
          return;
        }
      } else {
        console.log('LLM decided not to use any server for this query');
      }
    } else {
      console.log('No MCP servers available');
    }
  } catch (error) {
    console.error('MCP tool selection/execution failed:', error);
    
    // Improved error handling
    if (toolSelectionResponse && toolSelectionResponse.serverName && 
        (error.message.includes('timeout') || error.message.includes('connect'))) {
      await context.sendActivity(`⚠️ The ${toolSelectionResponse.serverName} is temporarily unavailable (${error.message}). Falling back to direct LLM response...`);
    } else {
      await context.sendActivity('❌ MCP tool execution failed. Using direct LLM response...');
    }
  }
  
  // Fallback to direct LLM response
  console.log('Using direct LLM response');
  try {
    const llmReply = await queryOllama(query);
    await context.sendActivity(llmReply);
  } catch (error) {
    await context.sendActivity('Sorry, could not reach any service to process your request.');
    console.error('LLM fallback error:', error);
  }
}

async function queryOllamaForServerSelection(query, availableServers) {
  const serverSelectionPrompt = `You are a server selection assistant. Given a user query and a list of available MCP servers, determine which server should be used.

User Query: "${query}"

Available Servers:
${JSON.stringify(availableServers, null, 2)}

Instructions:
1. Analyze the user query to determine which server best matches the user's intent
2. If a server matches, respond with JSON: {"useServer": true, "serverName": "server_name"}
3. If no server matches, respond with JSON: {"useServer": false}
4. Base your decision on the server descriptions and the user's query
5. IMPORTANT: Return ONLY valid JSON, no other text before or after

JSON Response:`;

  try {
    const response = await queryOllama(serverSelectionPrompt);
    console.log('LLM server selection response:', response);
    
    // Clean and parse JSON response (similar to tool selection)
    let cleanedResponse = response.trim();
    cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const firstBrace = cleanedResponse.indexOf('{');
    const lastBrace = cleanedResponse.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonString = cleanedResponse.substring(firstBrace, lastBrace + 1);
      console.log('Extracted server selection JSON:', jsonString);
      
      try {
        const parsed = JSON.parse(jsonString);
        console.log('Successfully parsed server selection:', parsed);
        return parsed;
      } catch (parseError) {
        console.error('Server selection JSON parse error:', parseError);
      }
    }
    
    console.warn('No valid JSON found in server selection response, falling back to no server');
    return { useServer: false };
    
  } catch (error) {
    console.error('Server selection error:', error);
    return { useServer: false };
  }
}

async function queryOllamaForToolSelection(query, availableTools) {
  const toolSelectionPrompt = `You are a tool selection assistant. Given a user query and a list of available tools, determine if any tool should be used and extract the necessary parameters.

User Query: "${query}"

Available Tools:
${JSON.stringify(availableTools, null, 2)}

Instructions:
1. Carefully analyze the user query against each tool's name and description
2. If a tool's description matches the user's intent, respond with JSON: {"usesTool": true, "serverName": "server_name", "toolName": "tool_name", "parameters": {...}}
3. If no tool matches, respond with JSON: {"usesTool": false}
4. Extract parameters based on the tool's parameter schema:
   - If the tool's parameters.properties is empty {}, use empty object: "parameters": {}
   - If the tool requires specific parameters, extract them from the user query
   - For coordinates: extract or estimate latitude/longitude from location names
   - For state codes: convert city/location names to appropriate state codes
   - For dates: extract or infer dates from the query
5. Use your knowledge to convert user-friendly terms to technical parameters when needed
6. IMPORTANT: Only include parameters that are actually defined in the tool's parameter schema
7. IMPORTANT: The "parameters" field should contain actual values, NOT the schema definition itself
8. IMPORTANT: Return ONLY valid JSON, no other text before or after

JSON Response:`;

  try {
    const response = await queryOllama(toolSelectionPrompt);
    console.log('LLM tool selection response:', response);
    
    // Clean the response to extract just the JSON part
    let cleanedResponse = response.trim();
    
    // Remove any markdown code block markers
    cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Find the JSON object - look for the first { and last }
    const firstBrace = cleanedResponse.indexOf('{');
    const lastBrace = cleanedResponse.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      let jsonString = cleanedResponse.substring(firstBrace, lastBrace + 1);
      
      // Fix common malformed JSON issues from LLM
      jsonString = jsonString.replace('"parameters": {"}}', '"parameters": {}}');
      jsonString = jsonString.replace('"parameters": {"}', '"parameters": {}}');
      jsonString = jsonString.replace('"parameters": {"}"', '"parameters": {}}');
      
      // Handle cases where closing brace is missing
      if (jsonString.endsWith('"parameters": {}')) {
        jsonString += '}';
      }
      
      // Remove extra characters after the JSON
      if (jsonString.includes('"}')) {
        const validEnd = jsonString.lastIndexOf('}}');
        if (validEnd !== -1) {
          jsonString = jsonString.substring(0, validEnd + 2);
        }
      }
      
      console.log('Extracted JSON string:', jsonString);
      
      try {
        const parsed = JSON.parse(jsonString);
        console.log('Successfully parsed tool selection:', parsed);
        
        // Validate that parameters is actually parameters, not schema
        if (parsed.usesTool && parsed.parameters) {
          // If parameters looks like a schema definition, replace with empty object
          if (parsed.parameters.type === 'object' && parsed.parameters.properties !== undefined) {
            console.warn('LLM returned schema instead of parameters, correcting to empty object');
            parsed.parameters = {};
          }
          
          // Find the selected tool to check if it actually needs parameters
          const selectedTool = availableTools.find(t => 
            t.serverName === parsed.serverName && t.toolName === parsed.toolName
          );
          
          if (selectedTool && selectedTool.parameters && 
              selectedTool.parameters.type === 'object' && 
              Object.keys(selectedTool.parameters.properties || {}).length === 0) {
            // Tool has no parameters, so use empty object
            console.log('Tool requires no parameters, using empty object');
            parsed.parameters = {};
          }
        }
        
        return parsed;
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Failed to parse:', jsonString);
      }
    }
    
    // Fallback: try the original regex approach
    const jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    console.warn('No valid JSON found in LLM response, falling back to no tool');
    return { usesTool: false };
    
  } catch (error) {
    console.error('Tool selection error:', error);
    return { usesTool: false };
  }
}

async function formatMCPResultWithLLM(result, toolName, originalQuery) {
  if (!result) {
    return 'No result returned from the service.';
  }
  
  if (typeof result === 'string') {
    return result;
  }
  
  // Handle MCP result structure with content array
  if (result.content && Array.isArray(result.content)) {
    // Extract text from the first content item
    const firstContent = result.content[0];
    if (firstContent && firstContent.type === 'text' && firstContent.text) {
      return firstContent.text;
    }
  }
  
  // Handle structured content
  if (result.structuredContent && result.structuredContent.result) {
    return result.structuredContent.result;
  }
  
  // Handle direct content
  if (result.content && typeof result.content === 'string') {
    return result.content;
  }
  
  // Use LLM to format the result dynamically
  const formatPrompt = `You are a result formatter for NP AI Assistant. Format the following tool result in a user-friendly way.

Original User Query: "${originalQuery}"
Tool Used: ${toolName}
Raw Result: ${JSON.stringify(result, null, 2)}

Instructions:
1. Format the result in a clear, human-readable way suitable for Microsoft Teams
2. If it's a JSON list/array of objects, format it as a readable table or list
3. Use appropriate emojis and markdown formatting (tables, bullet points, etc.)
4. For employee data, create a clean table with requested columns
5. For weather data, present temperature, conditions, and alerts clearly
6. Convert technical data to user-friendly language
7. Convert units to metric system (Celsius, km/h, km) for European users when possible
8. If the result contains error information, present it clearly
9. Keep the response well-structured and easy to scan
10. Don't include raw JSON - make it human-readable

Format the result:`;

  try {
    const formattedResponse = await queryOllama(formatPrompt);
    return formattedResponse;
  } catch (error) {
    console.error('Result formatting error:', error);
    // Fallback to basic JSON formatting
    return `📋 **${toolName} Result**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
}

/**
 * Helper: Extract user input - handle @np mentions and direct bot conversations
 */
function extractUserQuery(text, context) {
  if (!text) return null;
  
  // In direct conversations with the bot, process all messages (no @np needed)
  if (context.activity.conversation.conversationType === 'personal') {
    return text.trim();
  }
  
  // In group chats or other contexts, require @np tag
  const npMatch = text.match(/@np\s*(.*)/i);
  return npMatch ? npMatch[1].trim() : null;
}

/**
 * Helper: Query Ollama's Gemma2:2B model
 */
async function queryOllama(prompt) {
  const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434') + '/api/generate';
  
  // Prepare headers
  const headers = { 'Content-Type': 'application/json' };
  
  // Add basic authentication if credentials are provided
  if (process.env.OLLAMA_AUTH_USER && process.env.OLLAMA_AUTH_PASS) {
    const credentials = Buffer.from(`${process.env.OLLAMA_AUTH_USER}:${process.env.OLLAMA_AUTH_PASS}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }
  
  const response = await fetch(ollamaUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: 'gemma2:2b', // Adjust model name to match your Ollama config
      prompt: prompt
    })
  });

// Stream & parse NDJSON
  const reader = response.body.getReader();
  let decoder = new TextDecoder('utf-8');
  let resultText = '';
  let done = false;
  let buffer = '';

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');

      // Keep last (possibly incomplete) line in buffer
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          try {
            const obj = JSON.parse(line);
            // Collect response text from each chunk/line
            if (obj.response) resultText += obj.response;
          } catch (err) {
            // Ignore parse errors for blank or partial lines
          }
        }
      }
    }
    done = readerDone;
  }
  // Optionally process any remaining buffer data
  return resultText || "No response from LLM.";
}

// Listen for user to say '/reset' and then delete conversation state
teamsBot.message("/reset", async (context, state) => {
  state.deleteConversationState();
  await context.sendActivity("Ok I've deleted the current conversation state.");
});

teamsBot.message("/count", async (context, state) => {
  const count = state.conversation.count ?? 0;
  await context.sendActivity(`The count is ${count}`);
});

teamsBot.message("/diag", async (context, state) => {
  await state.load(context, storage);
  await context.sendActivity(JSON.stringify(context.activity));
});

teamsBot.message("/state", async (context, state) => {
  await state.load(context, storage);
  await context.sendActivity(JSON.stringify(state));
});

teamsBot.message("/runtime", async (context, state) => {
  const runtime = {
    nodeversion: process.version,
    sdkversion: version,
  };
  await context.sendActivity(JSON.stringify(runtime));
});

teamsBot.message("/mcp", async (context, state) => {
  try {
    const serverSummary = mcpManager.getServerSummary();
    
    if (serverSummary.totalServers === 0) {
      await context.sendActivity("**MCP Server Status**\n\nNo servers currently connected. Servers are loaded on-demand when needed.");
      return;
    }
    
    let response = `**MCP Server Status** (${serverSummary.totalServers} connected servers)\n\n`;
    
    for (const server of serverSummary.servers) {
      response += `**${server.name}** ✅ Connected (${server.toolCount} tools)\n`;
      for (const tool of server.tools) {
        response += `  • \`${tool.name}\`: ${tool.description}\n`;
      }
      response += '\n';
    }
    
    await context.sendActivity(response);
  } catch (error) {
    await context.sendActivity("Error checking MCP server status: " + error.message);
  }
});

teamsBot.conversationUpdate("membersAdded", async (context, state) => {
  const welcomeMessage = `Hello! I'm NP AI Assistant. How can I help you? 😊`;
  
  await context.sendActivity(welcomeMessage);
});

// Listen for ANY message to be received. MUST BE AFTER ANY OTHER MESSAGE HANDLERS
teamsBot.activity(ActivityTypes.Message, async (context, state) => {
  // Increment count state
  let count = state.conversation.count ?? 0;
  state.conversation.count = ++count;

  const text = context.activity.text || '';
  const userPrompt = extractUserQuery(text, context);

  if (userPrompt) {
    try {
      await processUserQuery(context, userPrompt);
    } catch (error) {
      await context.sendActivity('Sorry, I encountered an error processing your request.');
      console.error('Query processing error:', error);
    }
  }
});


module.exports.teamsBot = teamsBot;
