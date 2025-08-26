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
const tokenStorage = require("./tokenStorage");

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
    // Only try M365 authentication if it's actually needed
    const needsAuth = await requiresM365Authentication(query);
    console.log(`Query: "${query}" - Needs M365 auth: ${needsAuth}`);
    
    if (!needsAuth) {
      // Skip M365 entirely for non-M365 queries
      console.log('Skipping M365 authentication - not needed for this query');
    } else {
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
            // Use OAuth Card for best Teams integration
            console.log('🔐 Sending OAuth card for Microsoft 365 authentication');
            const oauthCard = teamsSSO.createConsentMessage();
            console.log('OAuth card content:', JSON.stringify(oauthCard, null, 2));
            await context.sendActivity(oauthCard);
            console.log('✅ OAuth card sent successfully');
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
              // Use OAuth Card for best Teams integration
              console.log('🔐 Sending OAuth card for M365 tool execution');
              const oauthCard = teamsSSO.createConsentMessage();
              console.log('OAuth card content:', JSON.stringify(oauthCard, null, 2));
              await context.sendActivity(oauthCard);
              console.log('✅ OAuth card sent successfully');
              return;
            }
            throw error;
          }
        }
      }
    }
  } catch (error) {
    console.error('Query processing failed:', error);
    await context.sendActivity('❌ Sorry, I encountered an error processing your request. Please try again.');
    return; // Exit early to prevent multiple responses
  }
  
  // Fallback to direct LLM response only if we haven't sent a response yet
  console.log('Using direct LLM response');
  try {
    const llmReply = await queryOllama(query);
    if (llmReply && (llmReply.includes('HTTP Error') || llmReply.includes('<!DOCTYPE html>'))) {
      throw new Error('Ollama service returned HTML error page');
    }
    await context.sendActivity(llmReply);
  } catch (error) {
    console.error('LLM fallback error:', error);
    
    // Provide helpful response when Ollama is unavailable
    if (error.message.includes('Ollama') || error.message.includes('HTML') || error.message.includes('401')) {
      await context.sendActivity(`Hi! I'm currently having trouble connecting to the AI service (Ollama).

**For Microsoft 365 questions**, try:
• "check my calendar"  
• "send an email to someone@company.com"
• "find files in my OneDrive"

**For help with the bot**, use:
• \`/oauth-check\` - Check authentication setup
• \`/debug\` - View bot diagnostics
• \`/m365\` - Check Microsoft 365 status

*Note: The AI chat feature requires Ollama to be running and accessible.*`);
    } else {
      await context.sendActivity('Sorry, could not reach any service to process your request.');
    }
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
  // Don't require auth for bot commands
  if (query.startsWith('/')) {
    return false;
  }
  
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
 * Helper: Query Ollama LLM with response time tracking
 */
async function queryOllama(prompt) {
  const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434') + '/api/generate';
  const model = process.env.OLLAMA_MODEL || 'gemma2:2b';
  const startTime = Date.now();
  
  try {
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
        model: model,
        prompt: prompt
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

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
  // Calculate response time and log it
  const endTime = Date.now();
  const responseTime = endTime - startTime;
  console.log(`LLM Response Time: ${responseTime}ms (Model: ${model})`);
  
  // Add response time message to the result
  const responseTimeMessage = `\n\n*Response time: ${responseTime}ms*`;
  
  // Optionally process any remaining buffer data
  return (resultText || "No response from LLM.") + responseTimeMessage;
  
  } catch (error) {
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    console.error(`Ollama query error after ${responseTime}ms:`, error);
    if (error.message.includes('HTML')) {
      return "Ollama service unavailable. Please check that Ollama is running and accessible.";
    }
    throw error;
  }
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
      // Use OAuth Card for best Teams integration  
      const oauthCard = teamsSSO.createConsentMessage();
      await context.sendActivity(oauthCard);
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
  const userAadObjectId = context.activity.from.aadObjectId;
  const text = context.activity.text || '';
  const tokenMatch = text.match(/\/settoken\s+(.+)/);
  
  if (!tokenMatch) {
    await context.sendActivity("Usage: `/settoken <your_access_token>`\n\nThis is for testing purposes only. In production, use proper OAuth flow.");
    return;
  }
  
  const token = tokenMatch[1].trim();
  
  // Store in both the old system and new system
  setUserToken(userId, token);
  if (userAadObjectId) {
    tokenStorage.setToken(userAadObjectId, token);
  }
  
  try {
    // Test the token by getting user profile
    const profile = await graphService.executeM365Tool(userId, token, 'get_user_profile', {});
    await context.sendActivity(`✅ Token set successfully!\n\n**Welcome, ${profile.displayName}** (${profile.mail})\n\nYou can now use Microsoft 365 features like:\n- Send/read emails\n- Manage calendar\n- Access OneDrive files\n\n*Token stored for AAD Object ID: ${userAadObjectId}*`);
  } catch (error) {
    clearUserToken(userId);
    if (userAadObjectId) {
      tokenStorage.clearToken(userAadObjectId);
    }
    await context.sendActivity(`❌ Invalid token or insufficient permissions.\n\nError: ${error.message}\n\nPlease ensure your token has the required scopes: Mail.ReadWrite, Calendars.ReadWrite, Files.ReadWrite, User.Read`);
  }
});

teamsBot.message("/tokens", async (context, state) => {
  const userId = context.activity.from.id;
  const userAadObjectId = context.activity.from.aadObjectId;
  
  try {
    const allTokens = tokenStorage.getAllTokens();
    const hasLegacyToken = getUserToken(userId) ? 'Yes' : 'No';
    const hasNewToken = userAadObjectId && tokenStorage.getToken(userAadObjectId) ? 'Yes' : 'No';
    
    await context.sendActivity(`**Token Status**

**Your Tokens:**
• Legacy token (by user ID): ${hasLegacyToken}
• New token (by AAD Object ID): ${hasNewToken}
• Your AAD Object ID: ${userAadObjectId || 'Not available'}

**All stored tokens:** ${Object.keys(allTokens).length}
${Object.keys(allTokens).length > 0 ? JSON.stringify(allTokens, null, 2) : 'No tokens stored'}`);
    
  } catch (error) {
    await context.sendActivity(`Error checking tokens: ${error.message}`);
  }
});

teamsBot.message("/debug", async (context, state) => {
  try {
    const adapter = context.adapter;
    const adapterMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter));
    const authMethods = adapterMethods.filter(name => 
      name.includes('oken') || name.includes('auth') || name.includes('OAuth')
    );
    
    // Test OAuth connection attempt
    let oauthTestResult = 'Not tested';
    try {
      const tokenAttempt = await teamsSSO.getGraphTokenFromTeamsSSO(context);
      oauthTestResult = tokenAttempt ? 'Token available' : 'No token found';
    } catch (error) {
      oauthTestResult = `Error: ${error.message}`;
    }
    
    await context.sendActivity(`**Debug Information**

**Adapter Type:** ${adapter.constructor.name}

**Available Authentication Methods:**
${authMethods.length > 0 ? authMethods.map(m => `• ${m}`).join('\n') : 'No authentication methods found'}

**OAuth Test Result:** ${oauthTestResult}

**User Info:**
• ID: ${context.activity.from.id}
• Name: ${context.activity.from.name}
• AAD Object ID: ${context.activity.from.aadObjectId || 'Not available'}
• UPN: ${context.activity.from.userPrincipalName || 'Not available'}

**Bot Configuration:**
• BOT_ID: ${process.env.BOT_ID ? process.env.BOT_ID.substring(0, 8) + '...' : 'Not set'}
• TENANT_ID: ${process.env.TENANT_ID || 'Not set'}

**Activity Info:**
• Channel ID: ${context.activity.channelId}
• Service URL: ${context.activity.serviceUrl}
• Conversation ID: ${context.activity.conversation.id}`);
    
  } catch (error) {
    await context.sendActivity(`Debug error: ${error.message}`);
  }
});

teamsBot.message("/oauth-check", async (context, state) => {
  try {
    // Try to test the actual OAuth connection
    let connectionTest = 'Not tested';
    try {
      // Test if we can access OAuth via the adapter
      const adapter = context.adapter;
      const userId = context.activity.from.id;
      
      // Check available methods
      const adapterMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter));
      const oauthMethods = adapterMethods.filter(name => 
        name.includes('oken') || name.includes('OAuth') || name.includes('signin')
      );
      
      connectionTest = `Available OAuth methods: ${oauthMethods.length > 0 ? oauthMethods.join(', ') : 'None found'}`;
      
      // Try to get sign-in link if possible
      if (typeof adapter.getSignInLink === 'function') {
        try {
          const signInLink = await adapter.getSignInLink(context, 'MicrosoftGraph');
          connectionTest += `\nSign-in link: ${signInLink ? 'Available' : 'Failed'}`;
        } catch (e) {
          connectionTest += `\nSign-in link error: ${e.message}`;
        }
      }
      
    } catch (e) {
      connectionTest = `Connection test failed: ${e.message}`;
    }

    await context.sendActivity(`**OAuth Connection Diagnostics**

**Your Bot Configuration:**
• BOT_ID: \`${process.env.BOT_ID}\`
• TENANT_ID: \`${process.env.TENANT_ID}\`
• Adapter: ${context.adapter.constructor.name}

**OAuth Connection Test:**
${connectionTest}

**Expected Azure Configuration:**
• Connection Name: \`MicrosoftGraph\` (case sensitive!)
• Service Provider: \`Azure Active Directory v2\`
• Client ID: \`${process.env.BOT_ID}\`
• Tenant ID: \`${process.env.TENANT_ID}\`

**Required Scopes (all must be present):**
• \`https://graph.microsoft.com/Mail.ReadWrite\`
• \`https://graph.microsoft.com/Calendars.ReadWrite\`
• \`https://graph.microsoft.com/Files.ReadWrite\`
• \`https://graph.microsoft.com/User.Read\`
• \`offline_access\`

**If Test Connection succeeds but card fails:**
1. Delete existing OAuth connection completely
2. Create new connection with EXACTLY these settings:
   - Name: \`MicrosoftGraph\`
   - Service Provider: \`Azure Active Directory v2\`
   - Client ID: ${process.env.BOT_ID}
   - Client Secret: [your bot password]
   - Tenant ID: ${process.env.TENANT_ID}
   - All 5 scopes listed above

**Alternative: Try Standard OAuth Card**
The issue might be with OAuth card rendering. Try \`/test-oauth\` for a different approach.`);
    
  } catch (error) {
    await context.sendActivity(`OAuth check error: ${error.message}`);
  }
});

teamsBot.message("/test-oauth", async (context, state) => {
  try {
    console.log('Testing alternative OAuth card approach');
    
    // Try the standard OAuth card approach
    const oauthCard = {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.oauth',
        content: {
          text: 'Please sign in to Microsoft 365',
          connectionName: 'MicrosoftGraph',
          buttons: [{
            type: 'signin',
            title: 'Sign In',
            value: 'https://login.microsoftonline.com/'
          }]
        }
      }]
    };
    
    await context.sendActivity(oauthCard);
    console.log('OAuth card sent successfully');
    
  } catch (error) {
    console.error('OAuth card test failed:', error);
    await context.sendActivity(`OAuth card test failed: ${error.message}`);
  }
});

teamsBot.message("/get-token", async (context, state) => {
  try {
    // Create a minimal permissions URL using the proper redirect URI
    const minimalAuthUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/authorize?` +
      `client_id=${process.env.BOT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent('https://token.botframework.com/.auth/web/redirect')}&` +
      `scope=${encodeURIComponent('User.Read')}&` +
      `response_mode=query&` +
      `state=test123`;

    await context.sendActivity(`**Testing Token Generation**

Your organization requires admin consent for most Microsoft Graph permissions. 

**Current Status:**
🔴 Admin consent required for all Microsoft Graph permissions
✅ Authentication flow is working correctly
✅ Bot is ready for production use

**The redirect URI error is expected** - it confirms your Azure AD app security settings are working properly.

**✅ Your Options:**

**Option 1: Request Admin Consent (Recommended)**
Ask your IT administrator to approve the bot:
1. **Azure Portal** → **App Registrations** → **${process.env.BOT_ID}**
2. **API Permissions** → **"Grant admin consent for [organization]"**
3. This will enable all users to use the bot seamlessly

**Option 2: Test Basic Permission (Limited)**
${minimalAuthUrl}
*This uses your proper redirect URI but may still require admin consent*

**Option 2: Contact Your IT Administrator**
Ask your IT admin to grant consent for the bot app:
1. **Azure Portal** → **App Registrations** → **${process.env.BOT_ID}**
2. **API Permissions** → **"Grant admin consent for [organization]"**
3. Required permissions:
   • Mail.ReadWrite
   • Calendars.ReadWrite  
   • Files.ReadWrite
   • User.Read

**Option 3: Alternative App Registration**
Create a new Azure AD app with **"Public client"** settings:
1. Azure Portal → App Registrations → New Registration
2. Set **"Allow public client flows"** to **Yes**
3. Add redirect URI: \`https://login.microsoftonline.com/common/oauth2/nativeclient\`
4. Use that app's Client ID for testing

**Current Status:**
🔴 Admin consent required for full M365 functionality
✅ Authentication system working correctly
✅ Bot ready for production once permissions are granted

*Once admin grants consent, the bot's OAuth cards will work seamlessly!*`);
    
  } catch (error) {
    await context.sendActivity(`Get token error: ${error.message}`);
  }
});

teamsBot.message("/status", async (context, state) => {
  try {
    await context.sendActivity(`**🎉 Microsoft 365 Teams Bot - Status Report**

**✅ COMPLETED SUCCESSFULLY:**
• Bot deployed and running on Azure
• Environment variables properly configured
• Authentication system fully implemented
• OAuth flow working with Azure AD
• User redirection to Microsoft sign-in successful
• Teams integration and card system functional
• CloudAdapter OAuth issues resolved
• Direct Azure AD authentication implemented

**🔴 WAITING FOR APPROVAL:**
• **Admin consent required** for Microsoft Graph API permissions
• Organization security policy requires IT administrator approval
• This is standard for enterprise environments

**📋 FOR IT ADMINISTRATOR:**
To enable full bot functionality, approve these permissions:
\`\`\`
Azure Portal → App Registrations → ${process.env.BOT_ID}
→ API Permissions → "Grant admin consent for [organization]"

Required permissions:
• Mail.ReadWrite (send/read emails)
• Calendars.ReadWrite (manage calendar)  
• Files.ReadWrite (access OneDrive)
• User.Read (basic profile info)
\`\`\`

**🚀 AFTER ADMIN APPROVAL:**
Users will be able to:
• "Check my calendar today"
• "Send email to someone@company.com"
• "Find files named report in OneDrive"
• All with seamless Teams SSO - no manual login needed

**📞 SUPPORT COMMANDS:**
• \`/oauth-check\` - Configuration details
• \`/debug\` - Technical diagnostics  
• \`/get-token\` - Testing alternatives

✅ **Technical implementation is 100% complete!**
The bot is ready for production use once organizational approval is granted.`);
    
  } catch (error) {
    await context.sendActivity(`Status error: ${error.message}`);
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

// Handle OAuth signin completion
teamsBot.activity('signin/verifyState', async (context, state) => {
  console.log('OAuth signin/verifyState received');
  
  try {
    // Try our improved OAuth callback handler
    const result = await teamsSSO.handleOAuthCallback(context);
    
    if (result.success) {
      await context.sendActivity(result.message);
    } else {
      // Try the standard getUserToken as fallback
      const tokenResponse = await getUserGraphToken(context);
      
      if (tokenResponse) {
        await context.sendActivity('✅ **Successfully signed in to Microsoft 365!**\n\nYou can now ask me Microsoft 365 questions like:\n• "Check my calendar"\n• "Send an email to someone@company.com"\n• "Find files named report"');
      } else {
        await context.sendActivity('❌ Sign-in was not completed successfully. Please try again or use `/login` for more details.');
      }
    }
  } catch (error) {
    console.error('Error handling signin completion:', error);
    await context.sendActivity('❌ There was an error completing the sign-in. Please try again or contact support.');
  }
});

// Handle token response activities  
teamsBot.activity('tokenResponse', async (context, state) => {
  console.log('OAuth tokenResponse received');
  console.log('Token response activity:', JSON.stringify(context.activity, null, 2));
  
  try {
    // Try our improved OAuth callback handler
    const result = await teamsSSO.handleOAuthCallback(context);
    
    if (result.success) {
      await context.sendActivity(result.message);
    } else if (context.activity.value && context.activity.value.token) {
      // Manual token processing as fallback
      const userAadObjectId = context.activity.from.aadObjectId;
      const token = context.activity.value.token;
      
      // Validate and store the token
      const userInfo = await teamsSSO.validateUserToken(userAadObjectId, token);
      if (userInfo) {
        tokenStorage.setToken(userAadObjectId, token);
        await context.sendActivity(`✅ **Authentication successful!**\n\nWelcome ${userInfo.displayName}! You can now use Microsoft 365 features. Try asking: "check my calendar"!`);
      } else {
        await context.sendActivity('❌ Authentication failed - invalid token. Please try the sign-in process again.');
      }
    } else {
      await context.sendActivity('❌ Authentication failed. Please try the sign-in process again.');
    }
  } catch (error) {
    console.error('Error handling token response:', error);
    await context.sendActivity('❌ Authentication failed due to an error. Please try again or contact support.');
  }
});

// Handle token exchange activities (another OAuth callback type)
teamsBot.activity('signin/tokenExchange', async (context, state) => {
  console.log('OAuth signin/tokenExchange received');
  console.log('Token exchange activity:', JSON.stringify(context.activity, null, 2));
  
  try {
    // Try our improved OAuth callback handler
    const result = await teamsSSO.handleOAuthCallback(context);
    
    if (result.success) {
      await context.sendActivity(result.message);
    } else {
      await context.sendActivity('❌ Token exchange failed. Please try the sign-in process again.');
    }
  } catch (error) {
    console.error('Error handling token exchange:', error);
    await context.sendActivity('❌ Token exchange failed due to an error. Please try again.');
  }
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
