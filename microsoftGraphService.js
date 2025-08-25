const { Client } = require('@microsoft/microsoft-graph-client');

class MicrosoftGraphService {
  constructor() {
    this.userClients = new Map(); // Store Graph clients per user
    this.userTokens = new Map();  // Store tokens per user
  }

  /**
   * Get or create a Graph client for a specific user
   */
  async getUserGraphClient(userId, accessToken) {
    if (!accessToken) {
      throw new Error('Access token required for user impersonation');
    }

    // Store token for this user
    this.userTokens.set(userId, accessToken);

    // Create authentication provider with user token
    const authProvider = {
      getAccessToken: async () => {
        return accessToken;
      }
    };

    // Create Graph client with user's token
    const graphClient = Client.initWithMiddleware({
      authProvider: authProvider
    });

    this.userClients.set(userId, graphClient);
    return graphClient;
  }

  /**
   * Get available M365 tools/APIs that the LLM can choose from
   */
  getAvailableM365Tools() {
    return [
      {
        name: 'send_email',
        description: 'Send an email from user\'s account',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'array', items: { type: 'string' }, description: 'Email addresses to send to' },
            cc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to CC (optional)' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body content (HTML supported)' }
          },
          required: ['to', 'subject', 'body']
        }
      },
      {
        name: 'get_emails',
        description: 'Get emails from user\'s inbox',
        parameters: {
          type: 'object',
          properties: {
            top: { type: 'number', description: 'Number of emails to retrieve (default: 10)' },
            filter: { type: 'string', description: 'OData filter expression' },
            search: { type: 'string', description: 'Search query' }
          }
        }
      },
      {
        name: 'get_calendar_events',
        description: 'Get user\'s calendar events',
        parameters: {
          type: 'object',
          properties: {
            startDateTime: { type: 'string', description: 'Start date/time (ISO format)' },
            endDateTime: { type: 'string', description: 'End date/time (ISO format)' },
            top: { type: 'number', description: 'Number of events to retrieve' }
          }
        }
      },
      {
        name: 'create_calendar_event',
        description: 'Create a calendar event',
        parameters: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Event subject' },
            startDateTime: { type: 'string', description: 'Start date/time (ISO format)' },
            endDateTime: { type: 'string', description: 'End date/time (ISO format)' },
            body: { type: 'string', description: 'Event description' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
            timeZone: { type: 'string', description: 'Time zone (default: UTC)' }
          },
          required: ['subject', 'startDateTime', 'endDateTime']
        }
      },
      {
        name: 'search_files',
        description: 'Search files in user\'s OneDrive',
        parameters: {
          type: 'object',
          properties: {
            searchQuery: { type: 'string', description: 'Search query for files' },
            top: { type: 'number', description: 'Number of files to retrieve' }
          },
          required: ['searchQuery']
        }
      },
      {
        name: 'get_file_content',
        description: 'Get content of a specific file from OneDrive',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'ID of the file to retrieve' }
          },
          required: ['fileId']
        }
      },
      {
        name: 'create_file',
        description: 'Create a new file in user\'s OneDrive',
        parameters: {
          type: 'object',
          properties: {
            fileName: { type: 'string', description: 'Name of the file to create' },
            content: { type: 'string', description: 'File content' },
            folderPath: { type: 'string', description: 'Folder path (default: root)' }
          },
          required: ['fileName', 'content']
        }
      },
      {
        name: 'get_user_profile',
        description: 'Get user\'s profile information',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  /**
   * Execute a Microsoft Graph API call based on tool selection
   */
  async executeM365Tool(userId, accessToken, toolName, parameters) {
    const client = await this.getUserGraphClient(userId, accessToken);

    switch (toolName) {
      case 'send_email':
        return await this._sendEmail(client, parameters);
      
      case 'get_emails':
        return await this._getEmails(client, parameters);
      
      case 'get_calendar_events':
        return await this._getCalendarEvents(client, parameters);
      
      case 'create_calendar_event':
        return await this._createCalendarEvent(client, parameters);
      
      case 'search_files':
        return await this._searchFiles(client, parameters);
      
      case 'get_file_content':
        return await this._getFileContent(client, parameters);
      
      case 'create_file':
        return await this._createFile(client, parameters);
      
      case 'get_user_profile':
        return await this._getUserProfile(client, parameters);
      
      default:
        throw new Error(`Unknown M365 tool: ${toolName}`);
    }
  }

  // Private helper methods for each API call
  async _sendEmail(client, params) {
    const message = {
      subject: params.subject,
      body: {
        contentType: 'HTML',
        content: params.body
      },
      toRecipients: params.to.map(email => ({
        emailAddress: { address: email }
      })),
      ccRecipients: params.cc ? params.cc.map(email => ({
        emailAddress: { address: email }
      })) : []
    };

    return await client.api('/me/sendMail').post({ message });
  }

  async _getEmails(client, params) {
    let query = client.api('/me/messages');
    
    if (params.top) query = query.top(params.top);
    if (params.filter) query = query.filter(params.filter);
    if (params.search) query = query.search(params.search);
    
    query = query.select('id,subject,from,receivedDateTime,bodyPreview');
    query = query.orderby('receivedDateTime desc');

    return await query.get();
  }

  async _getCalendarEvents(client, params) {
    let query = client.api('/me/events');
    
    if (params.startDateTime && params.endDateTime) {
      query = query.filter(`start/dateTime ge '${params.startDateTime}' and end/dateTime le '${params.endDateTime}'`);
    }
    if (params.top) query = query.top(params.top);
    
    query = query.select('id,subject,start,end,attendees');
    query = query.orderby('start/dateTime');

    return await query.get();
  }

  async _createCalendarEvent(client, params) {
    const event = {
      subject: params.subject,
      body: {
        contentType: 'HTML',
        content: params.body || ''
      },
      start: {
        dateTime: params.startDateTime,
        timeZone: params.timeZone || 'UTC'
      },
      end: {
        dateTime: params.endDateTime,
        timeZone: params.timeZone || 'UTC'
      },
      attendees: params.attendees ? params.attendees.map(email => ({
        emailAddress: { address: email }
      })) : []
    };

    return await client.api('/me/events').post(event);
  }

  async _searchFiles(client, params) {
    let query = client.api('/me/drive/root/search(q=\'' + params.searchQuery + '\')');
    
    if (params.top) query = query.top(params.top);
    query = query.select('id,name,size,lastModifiedDateTime,webUrl');

    return await query.get();
  }

  async _getFileContent(client, params) {
    // Get file metadata first
    const fileInfo = await client.api(`/me/drive/items/${params.fileId}`).get();
    
    // Get file content - handle different file types
    let content;
    try {
      content = await client.api(`/me/drive/items/${params.fileId}/content`).get();
      
      // Convert binary content to text if possible
      if (fileInfo.file && fileInfo.file.mimeType) {
        const mimeType = fileInfo.file.mimeType;
        if (mimeType.startsWith('text/') || mimeType === 'application/json') {
          content = content.toString();
        } else {
          content = `[Binary file: ${fileInfo.name}] - Content preview not available for ${mimeType}`;
        }
      }
    } catch (error) {
      content = `Error reading file content: ${error.message}`;
    }
    
    return {
      fileInfo,
      content
    };
  }

  async _createFile(client, params) {
    const uploadPath = params.folderPath && params.folderPath !== '/' ? 
      `/me/drive/root:${params.folderPath}/${params.fileName}:/content` : 
      `/me/drive/root:/${params.fileName}:/content`;

    return await client.api(uploadPath).put(params.content);
  }

  async _getUserProfile(client, params) {
    return await client.api('/me').select('displayName,mail,userPrincipalName,jobTitle,department').get();
  }

  /**
   * Clear user tokens (for logout)
   */
  clearUserTokens(userId) {
    this.userTokens.delete(userId);
    this.userClients.delete(userId);
  }
}

module.exports = MicrosoftGraphService;