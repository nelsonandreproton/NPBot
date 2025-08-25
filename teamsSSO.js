const { ConfidentialClientApplication } = require('@azure/msal-node');

class TeamsSSO {
  constructor() {
    this.clientApp = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.BOT_ID, // Your bot's client ID
        clientSecret: process.env.BOT_PASSWORD, // Your bot's client secret
        authority: `https://login.microsoftonline.com/${process.env.TENANT_ID || 'common'}`
      }
    });
  }

  /**
   * Exchange Teams SSO token for Microsoft Graph token
   */
  async getGraphTokenFromTeamsSSO(context) {
    try {
      // Get the user's AAD object ID from Teams context
      const userAadObjectId = context.activity.from.aadObjectId;
      const userPrincipalName = context.activity.from.userPrincipalName;
      
      if (!userAadObjectId) {
        throw new Error('User AAD Object ID not available. Ensure the bot has "identity" permission.');
      }

      console.log(`Getting Graph token for user: ${userPrincipalName} (${userAadObjectId})`);

      // Use On-Behalf-Of flow to get Graph token
      // Note: This requires the user to have already consented to the app's permissions
      const oboRequest = {
        oboAssertion: context.activity.channelData?.ssoToken || 
                      await this.getTeamsSSOToken(context),
        scopes: [
          'https://graph.microsoft.com/Mail.ReadWrite',
          'https://graph.microsoft.com/Calendars.ReadWrite', 
          'https://graph.microsoft.com/Files.ReadWrite',
          'https://graph.microsoft.com/User.Read'
        ],
        skipCache: false
      };

      const response = await this.clientApp.acquireTokenOnBehalfOf(oboRequest);
      
      if (response && response.accessToken) {
        console.log(`Successfully obtained Graph token for ${userPrincipalName}`);
        return response.accessToken;
      }
      
      throw new Error('No access token received from OBO flow');
      
    } catch (error) {
      console.error('Teams SSO token exchange failed:', error);
      
      // Check for specific error types
      if (error.errorCode === 'invalid_grant') {
        throw new Error('User needs to consent to app permissions. Please run /consent command first.');
      } else if (error.errorCode === 'unauthorized_client') {
        throw new Error('Bot is not authorized for this operation. Check Azure AD app configuration.');
      }
      
      throw error;
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
   * Create an OAuth sign-in card for consent when SSO fails
   */
  createConsentCard() {
    const signInLink = `https://login.microsoftonline.com/${process.env.TENANT_ID || 'common'}/oauth2/v2.0/authorize?` +
      `client_id=${process.env.BOT_ID}&` +
      `response_type=code&` +
      `scope=https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read&` +
      `response_mode=query`;

    return {
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: '🔐 Microsoft 365 Authentication Required',
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'TextBlock',
          text: 'To access your Microsoft 365 data (email, calendar, files), please sign in and grant permissions.',
          wrap: true
        },
        {
          type: 'TextBlock',
          text: 'Required Permissions:',
          weight: 'Bolder'
        },
        {
          type: 'TextBlock',
          text: '• Mail.ReadWrite - Send and read emails\n• Calendars.ReadWrite - Manage calendar events\n• Files.ReadWrite - Access OneDrive files\n• User.Read - Get profile information',
          wrap: true
        }
      ],
      actions: [
        {
          type: 'Action.OpenUrl',
          title: 'Sign In to Microsoft 365',
          url: signInLink
        }
      ]
    };
  }

  /**
   * Alternative: Use Teams authentication with OAuthCards
   */
  createOAuthCard() {
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.oauth',
          content: {
            text: 'Please sign in to Microsoft 365',
            connectionName: 'Microsoft365Connection', // Configured in Azure Bot Service
            buttons: [
              {
                type: 'signin',
                title: 'Sign In',
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
}

module.exports = TeamsSSO;