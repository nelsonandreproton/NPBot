const { ConfidentialClientApplication } = require('@azure/msal-node');
const tokenStorage = require('./tokenStorage');

class TeamsSSO {
  constructor() {
    // Validate required environment variables
    const requiredEnvVars = {
      BOT_ID: process.env.BOT_ID,
      BOT_PASSWORD: process.env.BOT_PASSWORD,
      TENANT_ID: process.env.TENANT_ID || 'common'
    };

    // Check for missing environment variables
    const missingVars = Object.entries(requiredEnvVars)
      .filter(([key, value]) => !value || value.trim() === '')
      .map(([key]) => key);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}. Please check your .env file or Azure App Service configuration.`);
    }

    console.log('Environment variables loaded:');
    console.log(`BOT_ID: ${requiredEnvVars.BOT_ID ? requiredEnvVars.BOT_ID.substring(0, 8) + '...' : 'MISSING'}`);
    console.log(`BOT_PASSWORD: ${requiredEnvVars.BOT_PASSWORD ? '*'.repeat(8) : 'MISSING'}`);
    console.log(`TENANT_ID: ${requiredEnvVars.TENANT_ID}`);

    try {
      this.clientApp = new ConfidentialClientApplication({
        auth: {
          clientId: requiredEnvVars.BOT_ID,
          clientSecret: requiredEnvVars.BOT_PASSWORD,
          authority: `https://login.microsoftonline.com/${requiredEnvVars.TENANT_ID}`
        }
      });
      console.log('✅ MSAL ConfidentialClientApplication initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize MSAL client:', error.message);
      throw error;
    }
  }

  /**
   * Get Microsoft Graph token using Bot Framework OAuth
   */
  async getGraphTokenFromTeamsSSO(context) {
    try {
      const userAadObjectId = context.activity.from.aadObjectId;
      const userPrincipalName = context.activity.from.userPrincipalName;
      
      if (!userAadObjectId) {
        throw new Error('User AAD Object ID not available. Ensure the bot has "identity" permission.');
      }

      console.log(`Getting Graph token for user: ${userPrincipalName} (${userAadObjectId})`);
      console.log('Adapter type:', context.adapter.constructor.name);

      // Try our custom token storage first (for previously authenticated users)
      console.log('Checking custom token storage...');
      const storedToken = tokenStorage.getToken(userAadObjectId);
      
      if (storedToken) {
        console.log(`Found valid token in custom storage for ${userPrincipalName}`);
        
        // Validate the token before using it
        const userInfo = await this.validateUserToken(userAadObjectId, storedToken);
        if (userInfo) {
          console.log(`Token validation successful for ${userInfo.displayName}`);
          return storedToken;
        } else {
          console.log('Stored token is invalid, clearing it');
          tokenStorage.clearToken(userAadObjectId);
        }
      }

      // Try different CloudAdapter methods to get OAuth token
      const adapter = context.adapter;
      
      // Method 1: Try getUserToken (standard Bot Framework)
      if (typeof adapter.getUserToken === 'function') {
        try {
          console.log('Trying getUserToken method...');
          const tokenResponse = await adapter.getUserToken(context, 'MicrosoftGraph');
          
          if (tokenResponse && tokenResponse.token) {
            console.log(`Successfully obtained Graph token via getUserToken for ${userPrincipalName}`);
            // Store token for future use
            tokenStorage.setToken(userAadObjectId, tokenResponse.token, tokenResponse.expiration);
            return tokenResponse.token;
          }
        } catch (error) {
          console.log('getUserToken method failed:', error.message);
        }
      }
      
      // Method 2: Try getOAuthToken (CloudAdapter specific)  
      if (typeof adapter.getOAuthToken === 'function') {
        try {
          console.log('Trying getOAuthToken method...');
          const tokenResponse = await adapter.getOAuthToken(context, 'MicrosoftGraph');
          
          if (tokenResponse && tokenResponse.token) {
            console.log(`Successfully obtained Graph token via getOAuthToken for ${userPrincipalName}`);
            // Store token for future use
            tokenStorage.setToken(userAadObjectId, tokenResponse.token, tokenResponse.expiration);
            return tokenResponse.token;
          }
        } catch (error) {
          console.log('getOAuthToken method failed:', error.message);
        }
      }
      
      // Method 3: Try getTokenStatus 
      if (typeof adapter.getTokenStatus === 'function') {
        try {
          console.log('Trying getTokenStatus method...');
          const tokenStatus = await adapter.getTokenStatus(context, 'MicrosoftGraph');
          
          if (tokenStatus && tokenStatus.length > 0 && tokenStatus[0].token) {
            console.log(`Successfully obtained Graph token via getTokenStatus for ${userPrincipalName}`);
            // Store token for future use
            tokenStorage.setToken(userAadObjectId, tokenStatus[0].token);
            return tokenStatus[0].token;
          }
        } catch (error) {
          console.log('getTokenStatus method failed:', error.message);
        }
      }

      // Method 4: Try to use the OAuth connection directly with CloudAdapter
      if (typeof adapter.processActivity === 'function') {
        try {
          console.log('Trying direct OAuth connection access...');
          
          // Check if there's an ongoing OAuth flow or existing token
          const botFrameworkToken = await this.getBotFrameworkToken(context);
          if (botFrameworkToken) {
            console.log(`Successfully obtained token via Bot Framework OAuth for ${userPrincipalName}`);
            tokenStorage.setToken(userAadObjectId, botFrameworkToken);
            return botFrameworkToken;
          }
        } catch (error) {
          console.log('Direct OAuth connection access failed:', error.message);
        }
      }

      console.log('All token retrieval methods failed, user needs to sign in');
      console.log('Available adapter methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter(name => name.includes('oken') || name.includes('auth')));
      
      throw new Error('CONSENT_REQUIRED');
      
    } catch (error) {
      console.error('Graph token acquisition failed:', error);
      
      // Check for specific error types
      if (error.message === 'CONSENT_REQUIRED') {
        throw error;
      } else if (error.message && error.message.includes('consent')) {
        throw new Error('CONSENT_REQUIRED');
      }
      
      throw error;
    }
  }

  /**
   * Attempt to get token through Bot Framework OAuth connection
   */
  async getBotFrameworkToken(context) {
    try {
      // Use the Bot Framework REST API to get the OAuth token
      const { botConnectorFactory } = require('@microsoft/agents-hosting');
      
      if (botConnectorFactory) {
        const connector = botConnectorFactory.create();
        if (connector && typeof connector.getOAuthToken === 'function') {
          const tokenResponse = await connector.getOAuthToken(
            context.activity.from.id,
            'MicrosoftGraph',
            context.activity.channelId
          );
          
          return tokenResponse ? tokenResponse.token : null;
        }
      }
      
      return null;
    } catch (error) {
      console.log('Bot Framework OAuth token retrieval failed:', error.message);
      return null;
    }
  }

  /**
   * Get Teams SSO token directly from the activity
   */
  async getTeamsSSOToken(context) {
    // In Teams, SSO token should be available in different ways:
    
    // Method 1: From channel data (if SSO is properly configured)
    if (context.activity.channelData && context.activity.channelData.ssoToken) {
      return context.activity.channelData.ssoToken;
    }
    
    // Method 2: Request token using Teams SDK approach
    // This would typically require a card with authentication action
    throw new Error('SSO token not available in current context. May need user consent flow.');
  }

  /**
   * Create Bot Framework OAuth Card with proper session handling
   */
  createConsentMessage() {
    return {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: '🔐 Microsoft 365 Authentication Required',
              size: 'Large',
              weight: 'Bolder'
            },
            {
              type: 'TextBlock',
              text: 'To use Microsoft 365 features, you need to authenticate first.',
              wrap: true
            },
            {
              type: 'TextBlock',
              text: '**Required permissions:**\n📧 Mail.Read + Mail.Send\n📅 Calendars.ReadWrite\n📁 Files.ReadWrite.All\n👤 User.Read',
              wrap: true,
              spacing: 'Medium'
            },
            {
              type: 'TextBlock',
              text: '**Option 1: Use /settoken command**\nGet a token from [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer) and use `/settoken <your_token>`',
              wrap: true,
              spacing: 'Medium'
            },
            {
              type: 'TextBlock',
              text: '**Option 2: Contact your administrator**\nAsk your IT admin to configure the bot\'s OAuth connection in Azure Bot Service.',
              wrap: true,
              spacing: 'Small'
            }
          ]
        }
      }]
    };
  }

  /**
   * Create a Hero Card with proper Bot Framework OAuth URL as fallback
   */
  async createConsentMessageHero(context) {
    // Get proper Bot Framework OAuth URL with session management
    const botFrameworkUrl = await this.getBotFrameworkSignInUrl(context);

    return {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.hero',
        content: {
          title: '🔐 Microsoft 365 Authentication Required',
          subtitle: 'Sign in to access your emails, calendar, and files',
          text: `**Permissions needed:**\n📧 Mail.Read + Mail.Send - Send and read emails\n📅 Calendars.ReadWrite - Manage calendar events\n📁 Files.ReadWrite.All - Access OneDrive files\n👤 User.Read - Profile information\n\n*One-time setup - you won't need to sign in again.*`,
          images: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/512px-Microsoft_logo.svg.png'
          }],
          buttons: [{
            type: 'openUrl',
            title: '🔗 Sign In to Microsoft 365',
            value: botFrameworkUrl
          }]
        }
      }]
    };
  }

  /**
   * Generate proper Bot Framework OAuth URL with session management
   */
  generateBotFrameworkOAuthUrl(context) {
    const userId = context.activity.from.id;
    const channelId = context.activity.channelId;
    const serviceUrl = context.activity.serviceUrl;
    const conversationId = context.activity.conversation.id;
    
    // Generate a proper state parameter that Bot Framework can track
    const state = `${encodeURIComponent('MicrosoftGraph')}-${Date.now()}-${encodeURIComponent(userId)}`;
    
    // Use Bot Framework's OAuth endpoint that handles session cookies properly
    const botFrameworkOAuthUrl = `https://token.botframework.com/api/oauth/GetSigninLink?` +
      `botId=${encodeURIComponent(process.env.BOT_ID)}&` +
      `connectionName=${encodeURIComponent('MicrosoftGraph')}&` +
      `userId=${encodeURIComponent(userId)}&` +
      `channelId=${encodeURIComponent(channelId)}&` +
      `serviceUrl=${encodeURIComponent(serviceUrl)}&` +
      `conversationId=${encodeURIComponent(conversationId)}&` +
      `state=${state}`;

    return botFrameworkOAuthUrl;
  }

  /**
   * Get simplified OAuth sign-in URL (avoiding Bot Framework REST API issues)
   */
  async getBotFrameworkSignInUrl(context) {
    // Use the manual URL generation method since Bot Framework REST API has auth issues
    return this.generateBotFrameworkOAuthUrl(context);
  }

  /**
   * Create admin consent message as fallback
   */
  createAdminConsentMessage() {
    return `🔐 **Microsoft 365 Permissions Required**

**Option 1: Admin Consent (Recommended)**
Your administrator can grant consent for all users:

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**  
3. Find app: **${process.env.BOT_ID}**
4. Go to **API permissions**
5. Click **"Grant admin consent for [Organization]"**
6. Click **"Yes"** to approve

After admin consent, all users can use M365 features automatically!

**Option 2: Individual User Consent**
For individual user consent, you need to:
1. Set up OAuth Connection in Azure Bot Service
2. Configure connection name: "MicrosoftGraph"
3. Use the proper OAuth flow

**Required permissions:**
📧 Mail.Read + Mail.Send, 📅 Calendars.ReadWrite, 📁 Files.ReadWrite.All, 👤 User.Read`;
  }

  /**
   * Alternative: Use Teams authentication with OAuthCards (requires Bot Framework OAuth Connection)
   */
  createOAuthCard() {
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.oauth',
          content: {
            text: 'Please sign in to Microsoft 365 to access your data',
            connectionName: 'MicrosoftGraph', // This must match the connection name in Azure Bot Service
            buttons: [
              {
                type: 'signin', 
                title: 'Sign In to Microsoft 365',
                value: 'https://login.microsoftonline.com/'
              }
            ]
          }
        }
      ]
    };
  }

  /**
   * Check if user has valid Graph token
   */
  async validateUserToken(userId, token) {
    try {
      // Make a simple Graph API call to validate token
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const userInfo = await response.json();
        console.log(`Token valid for user: ${userInfo.displayName} (${userInfo.mail})`);
        return userInfo;
      }
      
      return null;
    } catch (error) {
      console.error('Token validation failed:', error);
      return null;
    }
  }

  /**
   * Get user info from Teams context (available without additional permissions)
   */
  getUserInfoFromTeamsContext(context) {
    return {
      aadObjectId: context.activity.from.aadObjectId,
      userPrincipalName: context.activity.from.userPrincipalName,
      name: context.activity.from.name,
      id: context.activity.from.id,
      tenantId: context.activity.channelData?.tenant?.id
    };
  }

  /**
   * Handle incoming OAuth tokens from Bot Framework OAuth connection
   */
  async handleOAuthCallback(context) {
    try {
      const userAadObjectId = context.activity.from.aadObjectId;
      const userPrincipalName = context.activity.from.userPrincipalName;
      
      // Check if this is an OAuth callback
      if (context.activity.name === 'signin/tokenExchange' || 
          context.activity.name === 'signin/verifyState' ||
          context.activity.channelData?.postback) {
        
        console.log(`OAuth callback received for user: ${userPrincipalName}`);
        
        // Try to get the token from the callback
        let token = null;
        
        if (context.activity.value && context.activity.value.token) {
          token = context.activity.value.token;
        } else if (context.activity.channelData?.postback?.data) {
          // Parse token from postback data
          try {
            const data = JSON.parse(context.activity.channelData.postback.data);
            token = data.token;
          } catch (e) {
            console.log('Failed to parse postback data:', e.message);
          }
        }
        
        if (token) {
          // Validate and store the token
          const userInfo = await this.validateUserToken(userAadObjectId, token);
          if (userInfo) {
            tokenStorage.setToken(userAadObjectId, token);
            console.log(`OAuth token successfully stored for ${userInfo.displayName}`);
            
            return {
              success: true,
              message: `✅ Successfully signed in to Microsoft 365 as ${userInfo.displayName}!\n\nYou can now ask questions about your emails, calendar, and files. Try asking:\n• "What's on my calendar today?"\n• "Show me my recent emails"\n• "Find files in my OneDrive"`
            };
          }
        }
      }
      
      return { success: false };
    } catch (error) {
      console.error('OAuth callback handling failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = TeamsSSO;