// Simple token storage for CloudAdapter (since it doesn't have OAuth methods)
// In production, use a database instead of in-memory storage

class TokenStorage {
  constructor() {
    this.tokens = new Map(); // userId -> { token, expiresAt, refreshToken }
  }

  /**
   * Store user token
   */
  setToken(userId, token, expiresIn = 3600, refreshToken = null) {
    const expiresAt = Date.now() + (expiresIn * 1000);
    this.tokens.set(userId, {
      token,
      expiresAt,
      refreshToken
    });
    console.log(`Token stored for user ${userId}, expires at ${new Date(expiresAt).toISOString()}`);
  }

  /**
   * Get user token if still valid
   */
  getToken(userId) {
    const tokenData = this.tokens.get(userId);
    
    if (!tokenData) {
      console.log(`No token found for user ${userId}`);
      return null;
    }

    // Check if token is expired (with 5 minute buffer)
    if (Date.now() > (tokenData.expiresAt - 300000)) {
      console.log(`Token expired for user ${userId}`);
      this.tokens.delete(userId);
      return null;
    }

    console.log(`Valid token found for user ${userId}`);
    return tokenData.token;
  }

  /**
   * Remove user token
   */
  clearToken(userId) {
    this.tokens.delete(userId);
    console.log(`Token cleared for user ${userId}`);
  }

  /**
   * Get all stored tokens (for debugging)
   */
  getAllTokens() {
    const result = {};
    for (const [userId, tokenData] of this.tokens.entries()) {
      result[userId] = {
        hasToken: !!tokenData.token,
        expiresAt: new Date(tokenData.expiresAt).toISOString(),
        isExpired: Date.now() > tokenData.expiresAt
      };
    }
    return result;
  }
}

// Singleton instance
const tokenStorage = new TokenStorage();

module.exports = tokenStorage;