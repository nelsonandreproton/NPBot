require('dotenv').config();
const { ActivityTypes } = require("@microsoft/agents-activity");
const {
  AgentApplication,
  AttachmentDownloader,
  MemoryStorage,
} = require("@microsoft/agents-hosting");
const { version } = require("@microsoft/agents-hosting/package.json");
const MicrosoftGraphService = require("./microsoftGraphService");
const TeamsSSO = require("./teamsSSO");

const downloader = new AttachmentDownloader();

// Define storage and application
const storage = new MemoryStorage();
const teamsBot = new AgentApplication({
  storage,
  fileDownloaders: [downloader],
});

// Initialize Microsoft Graph Service and Teams SSO
const graphService = new MicrosoftGraphService();
const teamsSSO = new TeamsSSO();
console.log('Microsoft Graph Service ready - using Teams SSO authentication');

async function processUserQuery(context, query) {
  console.log(`Processing query: ${query}`);
  
  let toolSelectionResponse = null;
  const userId = context.activity.from.id;
  
  try {
    // Get available M365 tools
    const m365Tools = graphService.getAvailableM365Tools();
    
    // Try to get M365 token using Teams SSO
    let userToken = null;
    try {
      userToken = await getUserGraphToken(context);
    } catch (error) {
      if (error.message === 'CONSENT_REQUIRED') {
        console.log('User consent required for M365 access');
      } else {
        console.warn('Failed to get Graph token:', error.message);
      }
    }
    
    // Check if query requires M365 authentication
    if (await requiresM365Authentication(query)) {
      if (!userToken) {
        // Try to authenticate automatically in the background
        await context.sendActivity('🔐 Authenticating with Microsoft 365...');
        
        try {
          userToken = await getUserGraphToken(context);
          if (userToken) {
            await context.sendActivity('✅ Authentication successful! Processing your request...');
          }
        } catch (error) {
          if (error.message === 'CONSENT_REQUIRED') {
            await context.sendActivity({
              type: 'message',
              text: '🔐 **Microsoft 365 Permissions Required**\n\nTo access your Microsoft 365 data, please grant permissions by clicking the button below:',
              attachments: [{
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: teamsSSO.createConsentCard()
              }]
            });
            return;
          } else {
            console.error('Automatic authentication failed:', error);
            await context.sendActivity('❌ Authentication failed. Please contact your administrator or use `/login` for more details.');
            return;
          }
        }
      }
      
      if (userToken) {
        // Ask LLM to select M365 tool and extract parameters
        toolSelectionResponse = await queryOllamaForM365ToolSelection(query, m365Tools);
        
        if (toolSelectionResponse && toolSelectionResponse.usesTool) {
          console.log(`LLM selected M365 tool: ${toolSelectionResponse.toolName}`);
          
          await context.sendActivity(`🔍 Using Microsoft 365 (${toolSelectionResponse.toolName})`);
          
          // Execute M365 tool
          try {
            const result = await graphService.executeM365Tool(
              userId,
              userToken,
              toolSelectionResponse.toolName,
              toolSelectionResponse.parameters
            );
            
            // Format and send the result
            const formattedResult = await formatResultWithLLM(result, toolSelectionResponse.toolName, query);
            const resultText = typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult);
            await context.sendActivity(resultText);
            return;
          } catch (error) {
            if (error.message === 'CONSENT_REQUIRED') {
              await context.sendActivity({
                type: 'message',
                text: '🔐 **Additional Permissions Required**\n\nPlease grant permissions to continue:',
                attachments: [{
                  contentType: 'application/vnd.microsoft.card.adaptive',
                  content: teamsSSO.createConsentCard()
                }]
              });
              return;
            }
            throw error;
          }
        }
      }
    }
  } catch (error) {
    console.error('M365 tool execution failed:', error);
    await context.sendActivity('❌ Microsoft 365 tool execution failed. Using direct LLM response...');
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

// Helper functions for user authentication and M365 detection
const userTokens = new Map(); // Simple in-memory storage (use database in production)

function getUserToken(userId) {
  return userTokens.get(userId);
}

async function getUserGraphToken(context) {
  const userId = context.activity.from.id;
  
  // Check if we already have a cached token
  let token = getUserToken(userId);
  if (token) {
    // Validate the token
    const isValid = await teamsSSO.validateUserToken(userId, token);
    if (isValid) {
      return token;
    } else {
      // Token expired, remove it
      clearUserToken(userId);
    }
  }
  
  try {
    // Get new token using Teams SSO
    token = await teamsSSO.getGraphTokenFromTeamsSSO(context);
    if (token) {
      setUserToken(userId, token);
      return token;
    }
  } catch (error) {
    console.error('Teams SSO failed:', error);
    
    // Check if it's a consent issue
    if (error.message.includes('consent')) {
      throw new Error('CONSENT_REQUIRED');
    }
    
    throw error;
  }
  
  return null;
}

function setUserToken(userId, token) {
  userTokens.set(userId, token);
}

function clearUserToken(userId) {
  userTokens.delete(userId);
}

async function requiresM365Authentication(query) {
  // Comprehensive keyword detection for Microsoft 365 services
  const m365Keywords = [
    // Email
    'email', 'send email', 'mail', 'inbox', 'message', 'reply', 'forward',
    // Calendar  
    'calendar', 'schedule', 'meeting', 'appointment', 'event', 'available', 'busy',
    // OneDrive/Files
    'onedrive', 'files', 'documents', 'create file', 'search files', 'find file',
    'document', 'spreadsheet', 'presentation', 'word', 'excel', 'powerpoint',
    // General M365
    'microsoft 365', 'm365', 'office 365', 'outlook', 'teams files'
  ];
  
  const queryLower = query.toLowerCase();
  return m365Keywords.some(keyword => queryLower.includes(keyword));
}

async function queryOllamaForM365ToolSelection(query, availableTools) {
  const toolSelectionPrompt = `You are a Microsoft 365 tool selection assistant. Given a user query and available Microsoft 365 tools, determine which tool should be used and extract the necessary parameters.

User Query: "${query}"

Available Microsoft 365 Tools:
${JSON.stringify(availableTools, null, 2)}

Instructions:
1. Carefully analyze the user query against each tool's name and description
2. If a tool matches the user's intent, respond with JSON: {"usesTool": true, "toolName": "tool_name", "parameters": {...}}
3. If no tool matches, respond with JSON: {"usesTool": false}
4. Extract parameters based on the tool's parameter schema:
   - For emails: extract recipients, subject, and body content from the query
   - For calendar: extract dates, times, attendees, and event details
   - For files: extract file names, search terms, or content to create/find
5. Use your knowledge to convert user-friendly terms to technical parameters
6. For dates/times, convert to ISO 8601 format when possible
7. IMPORTANT: Only include parameters that are actually defined in the tool's parameter schema
8. IMPORTANT: The "parameters" field should contain actual values, NOT the schema definition
9. IMPORTANT: Return ONLY valid JSON, no other text before or after

JSON Response:`;

  try {
    const response = await queryOllama(toolSelectionPrompt);
    console.log('LLM M365 tool selection response:', response);
    
    // Clean the response to extract just the JSON part
    let cleanedResponse = response.trim();
    cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const firstBrace = cleanedResponse.indexOf('{');
    const lastBrace = cleanedResponse.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonString = cleanedResponse.substring(firstBrace, lastBrace + 1);
      console.log('Extracted M365 tool selection JSON:', jsonString);
      
      try {
        const parsed = JSON.parse(jsonString);
        console.log('Successfully parsed M365 tool selection:', parsed);
        return parsed;
      } catch (parseError) {
        console.error('M365 tool selection JSON parse error:', parseError);
      }
    }
    
    console.warn('No valid JSON found in M365 tool selection response');
    return { usesTool: false };
    
  } catch (error) {
    console.error('M365 tool selection error:', error);
    return { usesTool: false };
  }
}

async function formatResultWithLLM(result, toolName, originalQuery) {
  if (!result) {
    return 'No result returned from the service.';
  }
  
  if (typeof result === 'string') {
    return result;
  }
  
  // Handle MCP result structure with content array
  if (result.content && Array.isArray(result.content)) {
    const firstContent = result.content[0];
    if (firstContent && firstContent.type === 'text' && firstContent.text) {
      return firstContent.text;
    }
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
4. For email/calendar/file operations, present the information clearly
5. Convert technical data to user-friendly language
6. If the result contains error information, present it clearly
7. Keep the response well-structured and easy to scan
8. Don't include raw JSON - make it human-readable

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


teamsBot.message("/login", async (context, state) => {
  const userId = context.activity.from.id;
  
  try {
    // Try to get token using Teams SSO
    const token = await getUserGraphToken(context);
    
    if (token) {
      // Test the token by getting user profile
      const profile = await graphService.executeM365Tool(userId, token, 'get_user_profile', {});
      await context.sendActivity(`✅ **Authentication Status**

**Welcome, ${profile.displayName}** (${profile.mail})

🟢 **Status:** Ready for Microsoft 365 features
📧 Email access: Ready
📅 Calendar access: Ready  
📁 OneDrive access: Ready
👤 Profile access: Ready

**Note:** You don't need to run /login manually. I'll automatically authenticate when you ask Microsoft 365 questions like:
• "send an email to john@company.com"
• "what's on my calendar tomorrow"  
• "find files named report"`);
    }
  } catch (error) {
    if (error.message === 'CONSENT_REQUIRED') {
      await context.sendActivity({
        type: 'message',
        text: '🔐 **Microsoft 365 Authentication Required**\n\nYour Teams session is active, but additional permissions are needed for Microsoft 365 features.',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: teamsSSO.createConsentCard()
        }]
      });
    } else {
      await context.sendActivity(`❌ **Authentication Failed**

Error: ${error.message}

This might be due to:
• Bot not properly configured for Teams SSO
• Missing Azure AD app permissions
• User not properly authenticated in Teams

**Administrator Setup Required:**
1. Configure Azure AD app with Microsoft Graph permissions
2. Enable Teams SSO in bot configuration
3. Required scopes: Mail.ReadWrite, Calendars.ReadWrite, Files.ReadWrite, User.Read

For manual testing, you can use: \`/settoken <your_access_token>\``);
    }
  }
});

teamsBot.message("/consent", async (context, state) => {
  await context.sendActivity({
    type: 'message',
    text: '🔐 **Grant Microsoft 365 Permissions**\n\nClick the button below to grant permissions for Microsoft 365 features:',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: teamsSSO.createConsentCard()
    }]
  });
});

teamsBot.message("/logout", async (context, state) => {
  const userId = context.activity.from.id;
  clearUserToken(userId);
  graphService.clearUserTokens(userId);
  
  await context.sendActivity("🔓 Successfully logged out from Microsoft 365. You can log back in using /login command.");
});

teamsBot.message("/settoken", async (context, state) => {
  const userId = context.activity.from.id;
  const text = context.activity.text || '';
  const tokenMatch = text.match(/\/settoken\s+(.+)/);
  
  if (!tokenMatch) {
    await context.sendActivity("Usage: `/settoken <your_access_token>`\n\nThis is for testing purposes only. In production, use proper OAuth flow.");
    return;
  }
  
  const token = tokenMatch[1].trim();
  setUserToken(userId, token);
  
  try {
    // Test the token by getting user profile
    const profile = await graphService.executeM365Tool(userId, token, 'get_user_profile', {});
    await context.sendActivity(`✅ Token set successfully!\n\n**Welcome, ${profile.displayName}** (${profile.mail})\n\nYou can now use Microsoft 365 features like:\n- Send/read emails\n- Manage calendar\n- Access OneDrive files`);
  } catch (error) {
    clearUserToken(userId);
    await context.sendActivity(`❌ Invalid token or insufficient permissions.\n\nError: ${error.message}\n\nPlease ensure your token has the required scopes: Mail.ReadWrite, Calendars.ReadWrite, Files.ReadWrite, User.Read`);
  }
});

teamsBot.message("/m365", async (context, state) => {
  const userId = context.activity.from.id;
  
  let response = `**Microsoft 365 Integration Status**\n\n`;
  
  try {
    const token = await getUserGraphToken(context);
    
    if (token) {
      // Get user info to show authentication status
      const profile = await graphService.executeM365Tool(userId, token, 'get_user_profile', {});
      
      response += `🟢 **Status:** Authenticated via Teams SSO\n`;
      response += `👤 **User:** ${profile.displayName} (${profile.mail})\n\n`;
      response += `**Available Tools:**\n`;
      
      const m365Tools = graphService.getAvailableM365Tools();
      for (const tool of m365Tools) {
        response += `• \`${tool.name}\`: ${tool.description}\n`;
      }
      
      response += `\n**Usage:**\n`;
      response += `• Just ask me naturally: "send email", "check calendar", "find files", etc.\n`;
      response += `• Use \`/logout\` to sign out`;
    } else {
      response += `🔴 **Status:** Not authenticated\n\n`;
      response += `**Teams SSO Integration:** Ready\n`;
      response += `**Required:** Microsoft Graph permissions\n\n`;
      response += `**To get started:**\n`;
      response += `• Use \`/login\` to authenticate via Teams SSO\n`;
      response += `• Use \`/consent\` if permissions needed\n`;
      response += `• Use \`/settoken <token>\` for manual testing`;
    }
  } catch (error) {
    response += `⚠️ **Status:** Authentication Error\n\n`;
    response += `**Error:** ${error.message}\n\n`;
    
    const userInfo = teamsSSO.getUserInfoFromTeamsContext(context);
    if (userInfo.aadObjectId) {
      response += `**Teams User:** ${userInfo.name} (${userInfo.userPrincipalName})\n`;
      response += `**AAD Object ID:** ${userInfo.aadObjectId}\n\n`;
      response += `**Next Steps:**\n`;
      response += `• Use \`/consent\` to grant permissions\n`;
      response += `• Contact admin if SSO setup is incomplete`;
    } else {
      response += `**Issue:** Teams identity information not available\n`;
      response += `**Required:** Bot must have "identity" permission in manifest`;
    }
  }
  
  await context.sendActivity(response);
});

teamsBot.conversationUpdate("membersAdded", async (context, state) => {
  const welcomeMessage = `Hello! I'm **NP AI Assistant**. I can help you with Microsoft 365 tasks using natural language! 🤖

**Try asking me:**
• "Send an email to john@company.com about the meeting"
• "What's on my calendar tomorrow?"  
• "Find files named 'report' in my OneDrive"
• "Check my recent emails"

I'll automatically authenticate with your Microsoft 365 account when needed. No need to login first! ✨`;
  
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
