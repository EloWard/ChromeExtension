// IMMEDIATE Chrome Extension Detection - Must be FIRST
// This marks the Chrome extension as active so FFZ addon can detect it and disable itself
document.body.setAttribute('data-eloward-chrome-ext', 'active');
document.documentElement.setAttribute('data-eloward-chrome-ext', 'active');

// Extension state management
const extensionState = {
  isChannelActive: false,
  channelName: '',
  currentGame: null,
  currentUser: null,
  observerInitialized: false,
  lastChannelActiveCheck: null,
  initializationInProgress: false,
  currentInitializationId: null,
  compatibilityMode: false,
  initializationComplete: false,
  lastInitAttempt: 0,
  fallbackInitialized: false,
  chatMode: 'standard' // 'standard', 'seventv', 'ffz'
};

// Channel state tracking
const channelState = {
  activeChannels: new Set(),
  currentChannel: null,
  activeAbortController: null
};

// Rank-specific styling (matching FFZ addon)
const RANK_STYLES = {
  standard: {
    iron: { width: '28px', height: '28px', margin: '0 -2px 7.5px -6px' },
    bronze: { width: '26px', height: '26px', margin: '0 -1.5px 6px -5px' },
    silver: { width: '24px', height: '24px', margin: '0 0px 6px -4.5px' },
    gold: { width: '24px', height: '24px', margin: '0 0px 4px -4px' },
    platinum: { width: '24px', height: '24px', margin: '0 0.5px 3.5px -3.5px' },
    emerald: { width: '24px', height: '24px', margin: '0 1px 3px -3px' },
    diamond: { width: '24px', height: '24px', margin: '0 3px 4px -1px' },
    master: { width: '24px', height: '24px', margin: '0 3px 3px -1px' },
    grandmaster: { width: '24px', height: '24px', margin: '0 3px 2px -1px' },
    challenger: { width: '24px', height: '24px', margin: '0 3px 1px -1px' },
    unranked: { width: '24px', height: '24px', margin: '0 -0.2px 2.5px -3.5px' }
  },
  seventv: {
    iron: { width: '28px', height: '28px', margin: '0px -7px 5px -3px' },
    bronze: { width: '26px', height: '26px', margin: '0px -7px 3px -3px' },
    silver: { width: '24px', height: '24px', margin: '0px -7px 2px -3px' },
    gold: { width: '24px', height: '24px', margin: '0px -7px 0px -3px' },
    platinum: { width: '24px', height: '24px', margin: '2px -5px 0px -1px' },
    emerald: { width: '24px', height: '24px', margin: '2px -5px 0px -1px' },
    diamond: { width: '24px', height: '24px', margin: '0px -3px 0px 1px' },
    master: { width: '24px', height: '24px', margin: '2px -3px 0px 1px' },
    grandmaster: { width: '22px', height: '22px', margin: '3px -3px 0px 1px' },
    challenger: { width: '24px', height: '24px', margin: '2px -1px 0px 3px' },
    unranked: { width: '24px', height: '24px', margin: '1px -7px 0px -3px' }
  }
};

const RANK_TIERS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger', 'unranked'];

// Mode-specific selectors
const SELECTORS = {
  standard: {
    username: [
      '.chat-author__display-name',
      '[data-a-target="chat-message-username"]',
      '.chat-line__username',
      '.chat-author__intl-login'
    ],
    message: [
      '.chat-line__message',
      '.chat-line',
      '[data-a-target="chat-line-message"]'
    ]
  },
  seventv: {
    username: [
      '.seventv-chat-user-username',
      '.chat-author__display-name',
      '[data-a-target="chat-message-username"]'
    ],
    message: [
      '.seventv-message',
      '.chat-line__message',
      '.chat-line'
    ]
  },
  ffz: {
    username: [
      '.ffz-message-author',
      '.chat-author__display-name',
      '[data-a-target="chat-message-username"]'
    ],
    message: [
      '.ffz-message-line',
      '.ffz-chat-line',
      '.chat-line__message',
      '.chat-line'
    ]
  }
};

// Helper function to create badge element (reduces code duplication)
function createBadgeElement(rankData, size = 24) {
  const badge = document.createElement('span');
  badge.className = size === 28 ? 'eloward-rank-badge seventv-size' : 
                   size === 24 ? 'eloward-rank-badge standard-size' : 
                   'eloward-rank-badge';
  badge.dataset.rankText = formatRankText(rankData);
  
  const img = document.createElement('img');
  img.alt = rankData.tier;
  img.className = 'eloward-badge-img';
  img.width = size;
  img.height = size;
  img.src = `https://eloward-cdn.unleashai.workers.dev/lol/${rankData.tier.toLowerCase()}.png`;
  
  badge.appendChild(img);
  
  // Setup tooltip
  badge.addEventListener('mouseenter', showTooltip);
  badge.addEventListener('mouseleave', hideTooltip);
  
  badge.dataset.rank = rankData.tier;
  badge.dataset.division = rankData.division || '';
  badge.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                     rankData.leaguePoints.toString() : '';
  badge.dataset.username = rankData.summonerName || '';
  
  return badge;
}

// Processing state
let processedMessages = new Set();
let tooltipElement = null;

// Supported games
const SUPPORTED_GAMES = {
  'League of Legends': true
};

// Tooltip delay
let tooltipShowTimeout = null;

// Robust chat mode detection using DOM-based detection (most reliable)
function detectChatMode() {
  // Use DOM-based detection as primary method (most reliable)
  const has7TVElements = !!(
    document.querySelector('.seventv-message') ||
    document.querySelector('.seventv-chat-user') ||
    document.querySelector('[data-seventv]') ||
    document.querySelector('.seventv-paint')
  );
  
  const hasFFZElements = !!(
    document.querySelector('.ffz-message-line') ||
    document.querySelector('.ffz-chat-line') ||
    document.querySelector('[data-ffz-component]') ||
    document.querySelector('.ffz-addon')
  );
  
  // Determine mode based on DOM elements (most reliable)
  let detectedMode = 'standard';
  if (has7TVElements) {
    detectedMode = 'seventv';
  } else if (hasFFZElements) {
    detectedMode = 'ffz';
  }
  
  const previousMode = extensionState.chatMode;
  
  extensionState.compatibilityMode = detectedMode !== 'standard';
  extensionState.chatMode = detectedMode;
  
  console.log(`🔧 EloWard: Chat mode detected - ${detectedMode.toUpperCase()}`);
  
  // Only restart if mode actually changed after initialization
  if (extensionState.initializationComplete && detectedMode !== previousMode) {
    console.log(`🔧 EloWard: Chat mode changed from ${previousMode} to ${detectedMode} - Restarting`);
    restartExtension();
  }
  
  return { chatMode: detectedMode };
}



// Restart extension for compatibility
function restartExtension() {
  console.log(`🔄 EloWard: Restarting extension for compatibility`);
  
  // Clean up current state
  if (extensionState.channelName) {
    cleanupChannel(extensionState.channelName);
  }
  
  // Reset state
  extensionState.observerInitialized = false;
  extensionState.initializationInProgress = false;
  extensionState.initializationComplete = false;
  extensionState.currentInitializationId = null;
  
  // Clear processed messages
  processedMessages.clear();
  
  // Wait a bit for DOM to settle, then reinitialize
  setTimeout(() => {
    if (getCurrentChannelName()) {
      initializeExtension();
    }
  }, 2000);
}

// Setup compatibility monitoring
function setupCompatibilityMonitor() {
  let detectionCount = 0;
  const maxDetections = 2; // Maximum 2 detections total
  
  // Single follow-up detection after 5 seconds (only if needed)
  const scheduleFollowUpDetection = () => {
    if (detectionCount < maxDetections && extensionState.chatMode === 'standard') {
      setTimeout(() => {
        if (detectionCount < maxDetections) {
          detectionCount++;
          detectChatMode();
        }
      }, 5000); // Single check at 5 seconds
    }
  };
  
  // Schedule follow-up detection
  scheduleFollowUpDetection();
  
  // Lightweight monitoring for major extension additions only
  const compatibilityObserver = new MutationObserver((mutations) => {
    if (detectionCount >= maxDetections) {
      compatibilityObserver.disconnect();
      return;
    }
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Only detect major chat extension changes (chat container modifications)
            if (node.querySelector && (
                node.querySelector('.seventv-message') ||
                node.querySelector('.ffz-message-line') ||
                node.classList.contains('seventv-paint') ||
                node.classList.contains('ffz-addon')
            )) {
              if (detectionCount < maxDetections) {
                detectionCount++;
                detectChatMode();
                return; // Exit early after detection
              }
            }
          }
        }
      }
    }
  });
  
  compatibilityObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Clean up after 15 seconds - extensions usually load quickly
  setTimeout(() => {
    compatibilityObserver.disconnect();
  }, 15 * 1000);
}

// Fallback initialization system
function setupFallbackInitialization() {
  // If we haven't initialized after 10 seconds, try a fallback approach
  setTimeout(() => {
    if (!extensionState.initializationComplete && !extensionState.fallbackInitialized) {
      console.log(`⚠️ EloWard: Main initialization not complete after 10s, trying fallback`);
      extensionState.fallbackInitialized = true;
      fallbackInitialization();
    }
  }, 10000);
  
  // Also try fallback if we detect we're on a channel but haven't initialized
  const fallbackCheckInterval = setInterval(() => {
    const currentChannel = getCurrentChannelName();
    if (currentChannel && 
        !extensionState.initializationComplete && 
        !extensionState.initializationInProgress &&
        !extensionState.fallbackInitialized &&
        (Date.now() - extensionState.lastInitAttempt) > 15000) {
      
      console.log(`⚠️ EloWard: Detected channel ${currentChannel} but not initialized, trying fallback`);
      extensionState.fallbackInitialized = true;
      fallbackInitialization();
      clearInterval(fallbackCheckInterval);
    }
  }, 5000);
  
  // Clean up interval after 2 minutes
  setTimeout(() => {
    clearInterval(fallbackCheckInterval);
  }, 2 * 60 * 1000);
}

// Fallback initialization for when normal init fails
function fallbackInitialization() {
  console.log(`🔧 EloWard: Starting fallback initialization`);
  
  const currentChannel = getCurrentChannelName();
  if (!currentChannel) {
    console.log(`❌ EloWard: No channel detected in fallback`);
    return;
  }
  
  // Force compatibility mode if we detect any third-party extensions
  if (!extensionState.compatibilityMode) {
    const hasThirdPartyExtensions = !!(
      document.querySelector('.ffz-addon') ||
      document.querySelector('.seventv-paint') ||
      document.querySelector('[data-ffz-component]') ||
      document.querySelector('[data-seventv]') ||
      window.ffz ||
      window.FrankerFaceZ ||
      window.SevenTV
    );
    
    if (hasThirdPartyExtensions) {
      console.log(`🔧 EloWard: Fallback detected third-party extensions, enabling compatibility mode`);
      extensionState.compatibilityMode = true;
    }
  }
  
  // Add styles
  addExtensionStyles();
  
  // Try to find chat and set up observer directly
  let attempts = 0;
  const maxAttempts = 10;
  
  function tryFallbackSetup() {
    const chatContainer = findChatContainer();
    
    if (chatContainer) {
      console.log(`✅ EloWard: Fallback found chat container, setting up observer`);
      
      // Set basic state
      extensionState.channelName = currentChannel;
      extensionState.currentGame = 'League of Legends'; // Assume supported game for fallback
      extensionState.isChannelActive = true; // Assume active for fallback
      
      setupChatObserver(chatContainer);
      extensionState.observerInitialized = true;
      extensionState.initializationComplete = true;
      
      console.log(`🚀 EloWard: Fallback initialization complete for ${currentChannel}`);
    } else {
      attempts++;
      if (attempts < maxAttempts) {
        console.log(`⏳ EloWard: Fallback attempt ${attempts}/${maxAttempts} - retrying in ${attempts * 1000}ms`);
        setTimeout(tryFallbackSetup, attempts * 1000);
      } else {
        console.log(`❌ EloWard: Fallback failed after ${maxAttempts} attempts`);
      }
    }
  }
  
  tryFallbackSetup();
}

// Initialize extension
initializeStorage();

// Always setup URL observer first, regardless of current page
setupUrlChangeObserver();

// Initial chat mode detection
detectChatMode();

// Setup limited compatibility monitoring (max 2 detections total)
setupCompatibilityMonitor();

// Setup fallback initialization
setupFallbackInitialization();

// Then initialize if on a channel page
initializeExtension();

// Handle SPA navigation
window.addEventListener('popstate', function() {
  if (!extensionState.initializationInProgress) {
    initializeExtension();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
  if (extensionState.channelName) {
    cleanupChannel(extensionState.channelName);
  }
  clearRankCache();
});

/**
 * Clear rank cache and processed messages
 */
function clearRankCache() {
  chrome.runtime.sendMessage({ action: 'clear_rank_cache' });
  processedMessages.clear();
}

/**
 * Clean up state when leaving a channel
 */
function cleanupChannel(channelName) {
  console.log(`🧹 EloWard: Cleaning up channel: ${channelName}`);
  
  // Hide tooltips
  if (tooltipElement && tooltipElement.parentNode) {
    tooltipElement.parentNode.removeChild(tooltipElement);
    tooltipElement = null;
  }
  
  // Hide 7TV tooltips
  hideSevenTVTooltip();
  
  // Remove 7TV badges if detected
  if (extensionState.chatMode === 'seventv') {
    document.querySelectorAll('.eloward-rank-badge.seventv-integration').forEach(badge => {
      badge.remove();
    });
  }
  
  // Disconnect observers
  if (window._eloward_chat_observer) {
    window._eloward_chat_observer.disconnect();
    window._eloward_chat_observer = null;
  }
  
  if (window._eloward_game_observer) {
    window._eloward_game_observer.disconnect();
    window._eloward_game_observer = null;
  }
  
  // Clear processed messages
  processedMessages.clear();
  
  // Reset state
  extensionState.observerInitialized = false;
  extensionState.isChannelActive = false;
  extensionState.currentGame = null;
  extensionState.currentUser = null;
  
  // Cancel any active operations for this channel
  if (channelState.activeAbortController) {
    channelState.activeAbortController.abort();
    channelState.activeAbortController = null;
  }
  
  channelState.activeChannels.delete(channelName);
}

/**
 * Initialize channel and check channel_active status
 */
async function initializeChannel(channelName, initializationId) {
  if (!channelName) return false;
  
  const normalizedChannel = channelName.toLowerCase();
  const abortController = new AbortController();
  channelState.activeAbortController = abortController;
  
  try {
    if (extensionState.currentInitializationId !== initializationId) {
      return false;
    }
    
    channelState.activeChannels.add(normalizedChannel);
    channelState.currentChannel = normalizedChannel;
    
    const isActive = await checkChannelActive(channelName, true, abortController.signal);
    
    if (extensionState.currentInitializationId !== initializationId || abortController.signal.aborted) {
      return false;
    }
    
    if (isActive) {
      channelState.activeChannels.add(normalizedChannel);
      extensionState.isChannelActive = true;
      console.log(`✅ EloWard: Channel ${channelName} is active`);
    } else {
      channelState.activeChannels.delete(normalizedChannel);
      extensionState.isChannelActive = false;
      console.log(`❌ EloWard: Channel ${channelName} is not active`);
    }
    
    return isActive;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.log(`❌ EloWard: Error checking channel active status:`, error);
    }
    return false;
  }
}

function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    extensionState.currentUser = findCurrentUser(allData);
    
    if (extensionState.currentUser) {
      chrome.runtime.sendMessage({
        action: 'set_current_user',
        username: extensionState.currentUser
      });
    }
  });
}

function findCurrentUser(allData) {
  if (allData.eloward_persistent_twitch_user_data?.login) {
    return allData.eloward_persistent_twitch_user_data.login.toLowerCase();
  } 
  
  if (allData.twitchUsername) {
    return allData.twitchUsername.toLowerCase();
  }
  
  return null;
}

/**
 * Check if channel is active with caching
 */
async function checkChannelActive(channelName, forceCheck = false, signal = null) {
  if (!channelName) return false;
  
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
  
  // Use cache unless forced to check
  const now = Date.now();
  if (!forceCheck && 
      extensionState.lastChannelActiveCheck && 
      extensionState.channelName === channelName && 
      (now - extensionState.lastChannelActiveCheck) < 30000) {
    return extensionState.isChannelActive;
  }
  
  try {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Operation aborted', 'AbortError'));
        return;
      }
      
      const abortListener = () => {
        reject(new DOMException('Operation aborted', 'AbortError'));
      };
      
      if (signal) {
        signal.addEventListener('abort', abortListener, { once: true });
      }
      
      chrome.runtime.sendMessage(
        { 
          action: 'check_channel_active', 
          streamer: channelName,
          skipCache: true
        },
        (response) => {
          if (signal) {
            signal.removeEventListener('abort', abortListener);
          }
          
          if (signal?.aborted) {
            reject(new DOMException('Operation aborted', 'AbortError'));
            return;
          }
          
          if (chrome.runtime.lastError) {
            console.log(`❌ EloWard: Runtime error checking channel:`, chrome.runtime.lastError);
            resolve(false);
            return;
          }
          
          const isActive = response && response.active === true;
          console.log(`🔍 EloWard: Channel ${channelName} active check - ${isActive ? '✅ Active' : '❌ Inactive'}`);
          
          if (!signal?.aborted) {
            extensionState.lastChannelActiveCheck = now;
          }
          
          resolve(isActive);
        }
      );
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    console.log(`❌ EloWard: Error in checkChannelActive:`, error);
    return false;
  }
}

/**
 * Get current channel name from URL
 */
function getCurrentChannelName() {
  const pathSegments = window.location.pathname.split('/');
  
  // Handle moderator view
  if (pathSegments[1] === 'moderator' && pathSegments.length > 2) {
    return pathSegments[2].toLowerCase();
  }
  
  // Regular channel URL
  if (pathSegments[1] && 
      pathSegments[1] !== 'oauth2' && 
      !pathSegments[1].includes('auth')) {
    return pathSegments[1].toLowerCase();
  }
  
  return null;
}

/**
 * Get current game being streamed using Twitch GraphQL API (same method as FFZ addon)
 * This is the most reliable method and matches what the FFZ addon uses
 */
async function getCurrentGame() {
  const channelName = getCurrentChannelName();
  if (!channelName) {
    return null;
  }
  
  try {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
      },
      body: JSON.stringify({
        query: `
          query {
            user(login: "${channelName}") {
              stream {
                game {
                  id
                  name
                  displayName
                }
              }
            }
          }
        `
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const game = data?.data?.user?.stream?.game;
    
    if (game) {
      const gameName = game.name || game.displayName;
      console.log(`🎮 EloWard: Game detected - ${gameName}`);
      return gameName;
    }
    
    console.log(`🎮 EloWard: No game detected for ${channelName}`);
    return null;
  } catch (error) {
    console.log(`❌ EloWard: Error detecting game:`, error);
    return null;
  }
}

/**
 * Check if game is supported
 */
function isGameSupported(game) {
  if (!game) return false;
  
  // Direct match
  if (SUPPORTED_GAMES[game] === true) {
    return true;
  }
  
  // Case-insensitive match
  const gameLower = game.toLowerCase();
  for (const supportedGame of Object.keys(SUPPORTED_GAMES)) {
    if (supportedGame.toLowerCase() === gameLower) {
      return true;
    }
  }
  
  return false;
}

/**
 * Setup game change observer to detect mid-stream game switches
 */
function setupGameChangeObserver() {
  if (window._eloward_game_observer) {
    window._eloward_game_observer.disconnect();
    window._eloward_game_observer = null;
  }
  
  let gameCheckTimeout = null;
  
  function checkGameChange() {
    if (gameCheckTimeout) {
      clearTimeout(gameCheckTimeout);
    }
    
    gameCheckTimeout = setTimeout(async () => {
      const newGame = await getCurrentGame();
      
      if (newGame !== extensionState.currentGame) {
        const oldGame = extensionState.currentGame;
        extensionState.currentGame = newGame;
        
        console.log(`🎮 EloWard: Game changed from "${oldGame}" to "${newGame}"`);
        
        if (!isGameSupported(extensionState.currentGame)) {
          // Clean up for unsupported game
          if (window._eloward_chat_observer) {
            window._eloward_chat_observer.disconnect();
            window._eloward_chat_observer = null;
          }
          extensionState.observerInitialized = false;
          extensionState.isChannelActive = false;
        } else if (isGameSupported(extensionState.currentGame) && !isGameSupported(oldGame)) {
          // Reinitialize for supported game
          if (extensionState.channelName && !extensionState.initializationInProgress) {
            initializeExtension();
          }
        }
      }
    }, 1000);
  }
  
  const gameObserver = new MutationObserver(checkGameChange);
  const streamInfoTarget = document.querySelector('[data-a-target="stream-info-card"]');
  
  if (streamInfoTarget) {
    gameObserver.observe(streamInfoTarget, { 
      subtree: true, 
      childList: true,
      attributes: true,
      attributeFilter: ['data-a-target']
    });
    
    window._eloward_game_observer = gameObserver;
  }
}

/**
 * Main initialization function
 */
function initializeExtension() {
  // Prevent concurrent initializations
  if (extensionState.initializationInProgress) {
    console.log(`⏸️ EloWard: Initialization already in progress, skipping`);
    return;
  }
  
  // Track initialization attempts
  extensionState.lastInitAttempt = Date.now();
  
  // Get current channel
  const currentChannel = getCurrentChannelName();
  if (!currentChannel) {
    console.log(`❌ EloWard: No current channel detected`);
    return;
  }
  
  // Generate unique initialization ID
  const initializationId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  extensionState.currentInitializationId = initializationId;
  extensionState.initializationInProgress = true;
  extensionState.channelName = currentChannel;
  
  console.log(`🚀 EloWard: Initializing extension for channel: ${currentChannel} (ID: ${initializationId})`);
  
  // Chat mode already detected during initial setup
  
  // Add extension styles
  addExtensionStyles();
  
  // Notify background script of channel change
  chrome.runtime.sendMessage({
    action: 'channel_switched',
    oldChannel: channelState.currentChannel,
    newChannel: currentChannel
  });
  
  // Get current game and initialize
  setTimeout(async () => {
    if (extensionState.currentInitializationId !== initializationId) {
      console.log(`⏸️ EloWard: Initialization ID mismatch, aborting`);
      return;
    }
    
    const detectedGame = await getCurrentGame();
    extensionState.currentGame = detectedGame;
    
    console.log(`🎮 EloWard: Current game: ${extensionState.currentGame || 'None'}`);
    
    // Always setup game observer to monitor for changes
    setupGameChangeObserver();
    
    // Only proceed if game is supported
    if (!isGameSupported(extensionState.currentGame)) {
      console.log(`❌ EloWard: Game "${extensionState.currentGame}" is not supported`);
      extensionState.initializationInProgress = false;
      extensionState.initializationComplete = true;
      return;
    }
    
    console.log(`✅ EloWard: Game "${extensionState.currentGame}" is supported`);
    
    // Initialize channel
    initializeChannel(extensionState.channelName, initializationId)
      .then(channelActive => {
        if (extensionState.currentInitializationId !== initializationId) {
          console.log(`⏸️ EloWard: Initialization ID mismatch during channel init, aborting`);
          return;
        }
        
        if (channelActive) {
          console.log(`✅ EloWard: Channel is active, setting up observers`);
          if (!extensionState.observerInitialized) {
            initializeObserver();
          }
        } else {
          console.log(`❌ EloWard: Channel is not active, skipping observer setup`);
        }
        
        extensionState.initializationInProgress = false;
        extensionState.initializationComplete = true;
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          console.log(`❌ EloWard: Error during channel initialization:`, error);
        }
        extensionState.initializationInProgress = false;
        extensionState.initializationComplete = true;
      });
  }, 1500);
}

/**
 * Setup URL change observer for SPA navigation
 */
function setupUrlChangeObserver() {
  if (window._eloward_url_observer) return;
  
  const urlObserver = new MutationObserver(function(mutations) {
    const currentChannel = getCurrentChannelName();
    
    // Skip if on auth pages
    if (window.location.pathname.includes('oauth2') || 
        window.location.pathname.includes('auth/') ||
        window.location.href.includes('auth/callback') ||
        window.location.href.includes('auth/redirect')) {
      return;
    }
    
    // Handle channel changes (including from homepage to channel)
    if (currentChannel && currentChannel !== extensionState.channelName) {
      console.log(`🔄 EloWard: Channel changed from "${extensionState.channelName}" to "${currentChannel}"`);
      
      if (extensionState.channelName) {
        cleanupChannel(extensionState.channelName);
      }
      
      extensionState.channelName = currentChannel;
      extensionState.initializationComplete = false;
      clearRankCache();
      
      setTimeout(() => {
        const verifyChannel = getCurrentChannelName();
        if (verifyChannel === currentChannel) {
          initializeExtension();
        }
      }, 500);
    }
    // Handle navigation away from channels (e.g., to homepage)
    else if (!currentChannel && extensionState.channelName) {
      console.log(`🔄 EloWard: Navigated away from channel "${extensionState.channelName}"`);
      cleanupChannel(extensionState.channelName);
      extensionState.channelName = null;
      extensionState.initializationComplete = false;
    }
  });
  
  urlObserver.observe(document, { subtree: true, childList: true });
  window._eloward_url_observer = urlObserver;
}

/**
 * Find Twitch chat container with FFZ/7TV compatibility
 */
function findChatContainer() {
  // Enhanced selectors for compatibility with FFZ/7TV
  const selectors = [
    '.chat-scrollable-area__message-container',
    '[data-a-target="chat-scroller"]',
    '.chat-list--default',
    '.chat-list',
    '.simplebar-content', // FFZ scrollbar
    '[data-test-selector="chat-scrollable-area__message-container"]',
    '.chat-room__content .simplebar-content', // FFZ specific
    '.ffz-chat-container', // FFZ container
    '.seventv-chat-container' // 7TV container (if exists)
  ];
  
  for (const selector of selectors) {
    const container = document.querySelector(selector);
    if (container) {
      console.log(`📦 EloWard: Found chat container using selector: ${selector}`);
      return container;
    }
  }
  
  // Fallback: look for any message and find its container
  const anyMessage = document.querySelector('.chat-line__message, .chat-line, [data-a-target="chat-line-message"]');
  if (anyMessage) {
    const container = anyMessage.closest('[role="log"]') || anyMessage.parentElement;
    if (container) {
      console.log(`📦 EloWard: Found chat container via message fallback`);
      return container;
    }
  }
  
  console.log(`❌ EloWard: Could not find chat container`);
  return null;
}

/**
 * Initialize chat observer with retry mechanism
 */
function initializeObserver() {
  if (extensionState.observerInitialized) {
    console.log(`⏸️ EloWard: Observer already initialized`);
    return;
  }
  
  let attempts = 0;
  const maxAttempts = 5;
  
  function tryInitialize() {
    const chatContainer = findChatContainer();
    
    if (chatContainer) {
      setupChatObserver(chatContainer);
      extensionState.observerInitialized = true;
      console.log(`🚀 EloWard: Extension activated for ${extensionState.channelName} (attempt ${attempts + 1})`);
    } else {
      attempts++;
      if (attempts < maxAttempts) {
        console.log(`⏳ EloWard: Chat container not found, retrying in ${attempts * 1000}ms (attempt ${attempts}/${maxAttempts})`);
        setTimeout(tryInitialize, attempts * 1000);
      } else {
        console.log(`❌ EloWard: Failed to find chat container after ${maxAttempts} attempts`);
      }
    }
  }
  
  tryInitialize();
}

/**
 * Setup chat observer to watch for new messages with FFZ/7TV compatibility
 */
function setupChatObserver(chatContainer) {
  // Get selectors for current chat mode
  const currentSelectors = SELECTORS[extensionState.chatMode];
  const messageSelectors = currentSelectors.message;
  
  console.log(`📝 EloWard: Setting up chat observer in ${extensionState.chatMode} mode`);
  
  // Process existing messages with mode-specific handling
  if (extensionState.chatMode === 'seventv') {
    processExistingSevenTVMessages(chatContainer);
  } else {
    processExistingStandardMessages(chatContainer, messageSelectors);
  }
  
  // Set up mutation observer for new messages
  const chatObserver = new MutationObserver((mutations) => {
    if (!extensionState.isChannelActive) return;
    
    try {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if it's a message or contains messages using current mode selectors
              const isMessage = messageSelectors.some(selector => 
                node.matches && node.matches(selector)
              );
              
              if (isMessage) {
                processNewMessage(node);
              } else {
                // Check for messages within the added node
                const messages = node.querySelectorAll(messageSelectors.join(', '));
                for (const message of messages) {
                  processNewMessage(message);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.log(`❌ EloWard: Error in mutation observer:`, error);
    }
  });
  
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: true
  });
  
  window._eloward_chat_observer = chatObserver;
  
  // Set up delayed retry for messages that might load after extensions
  setTimeout(() => {
    try {
      if (extensionState.chatMode === 'seventv') {
        processExistingSevenTVMessages(chatContainer);
      } else {
        processExistingStandardMessages(chatContainer, messageSelectors);
      }
    } catch (error) {
      console.log(`❌ EloWard: Error in delayed message detection:`, error);
    }
  }, 3000);
}

/**
 * Process existing standard messages (non-7TV)
 */
function processExistingStandardMessages(chatContainer, messageSelectors) {
  try {
    const existingMessages = chatContainer.querySelectorAll(messageSelectors.join(', '));
    console.log(`📝 EloWard: Processing ${existingMessages.length} existing standard messages`);
    
    for (const message of existingMessages) {
      if (!processedMessages.has(message)) {
        processNewMessage(message);
      }
    }
  } catch (error) {
    console.log(`❌ EloWard: Error processing existing standard messages:`, error);
  }
}

/**
 * Process existing 7TV messages with specialized handling
 */
function processExistingSevenTVMessages(chatContainer) {
  try {
    const seventvSelectors = ['.seventv-message', '.chat-line__message', '.chat-line'];
    const existingMessages = chatContainer.querySelectorAll(seventvSelectors.join(', '));
    console.log(`📝 EloWard: Processing ${existingMessages.length} existing 7TV messages`);
    
    for (const message of existingMessages) {
      if (!processedMessages.has(message)) {
        processSevenTVMessage(message);
      }
    }

    // Also process any cached rank data and retroactively add badges
    if (existingMessages.length > 0) {
      retroactivelyAddSevenTVBadges();
    }
  } catch (error) {
    console.log(`❌ EloWard: Error processing existing 7TV messages:`, error);
  }
}

/**
 * Process a single 7TV message
 */
function processSevenTVMessage(messageElement) {
  if (!messageElement || processedMessages.has(messageElement)) return;
  processedMessages.add(messageElement);

  // Memory management
  if (processedMessages.size > 500) {
    const toDelete = Array.from(processedMessages).slice(0, 100);
    toDelete.forEach(msg => processedMessages.delete(msg));
  }

  if (!extensionState.isChannelActive) return;

  try {
    // Find username element using 7TV-specific selectors
    const usernameElement = messageElement.querySelector('.seventv-chat-user-username');
    if (!usernameElement) {
      return;
    }

    const username = usernameElement.textContent?.trim().toLowerCase();
    if (!username) {
      return;
    }

    // Check if badge already exists
    if (messageElement.querySelector('.eloward-rank-badge')) {
      return;
    }

    // Handle current user with stored Riot data (even if tokens expired)
    if (extensionState.currentUser && username === extensionState.currentUser.toLowerCase()) {
      chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
        const riotData = data.eloward_persistent_riot_user_data;
        
        if (riotData?.rankInfo) {
          const userRankData = {
            tier: riotData.rankInfo.tier,
            division: riotData.rankInfo.rank,
            leaguePoints: riotData.rankInfo.leaguePoints,
            summonerName: riotData.gameName
          };
          
          chrome.runtime.sendMessage({
            action: 'set_rank_data',
            username: username,
            rankData: userRankData
          });
          
          if (extensionState.channelName) {
            chrome.runtime.sendMessage({
              action: 'increment_db_reads',
              channel: extensionState.channelName
            });
            
            chrome.runtime.sendMessage({
              action: 'increment_successful_lookups',
              channel: extensionState.channelName
            });
          }
          
          addBadgeToSevenTVMessage(messageElement, usernameElement, userRankData);
        }
      });
      return;
    }
    
    // Fetch rank for other users
    fetchRankFromBackground(username, usernameElement, messageElement);
  } catch (error) {
    console.log(`❌ EloWard: Error processing 7TV message:`, error);
  }
}

/**
 * Retroactively add badges to existing 7TV messages for users we have cached data for
 */
function retroactivelyAddSevenTVBadges() {
  try {
    // Get rank cache from background script
    chrome.runtime.sendMessage({ action: 'get_all_cached_ranks' }, (response) => {
      if (response?.ranks) {
        const cachedRanks = response.ranks;
        
        // Find all 7TV user messages
        const userMessages = document.querySelectorAll('.seventv-chat-user');
        
        userMessages.forEach(messageElement => {
          if (messageElement.querySelector('.eloward-rank-badge')) {
            return; // Already has badge
          }
          
          const usernameElement = messageElement.querySelector('.seventv-chat-user-username');
          if (!usernameElement) {
            return;
          }
          
          const username = usernameElement.textContent?.trim().toLowerCase();
          if (!username || !cachedRanks[username]) {
            return;
          }
          
          const rankData = cachedRanks[username];
          addBadgeToSevenTVMessage(messageElement, usernameElement, rankData);
        });
      }
    });
  } catch (error) {
    console.log(`❌ EloWard: Error in retroactive 7TV badge addition:`, error);
  }
}

/**
 * Process new chat message for rank badges with enhanced compatibility
 */
function processNewMessage(messageNode) {
  if (!messageNode || processedMessages.has(messageNode)) return;

  if (!extensionState.isChannelActive) return;
  
  // Route to appropriate processor based on chat mode
  if (extensionState.chatMode === 'seventv') {
    processSevenTVMessage(messageNode);
    return;
  }

  // Standard/FFZ message processing
  processedMessages.add(messageNode);
  
  // Memory management
  if (processedMessages.size > 500) {
    const toDelete = Array.from(processedMessages).slice(0, 100);
    toDelete.forEach(msg => processedMessages.delete(msg));
  }

  try {
    // Get selectors for current chat mode
    const currentSelectors = SELECTORS[extensionState.chatMode];
    const usernameSelectors = currentSelectors.username;
    
    // Find username element using mode-specific selectors
    let usernameElement = null;
    for (const selector of usernameSelectors) {
      usernameElement = messageNode.querySelector(selector);
      if (usernameElement) break;
    }
    
    if (!usernameElement) return;
    
    const username = usernameElement.textContent?.trim().toLowerCase();
    if (!username) return;
    
         // Handle current user with stored Riot data (even if tokens expired)
     if (extensionState.currentUser && username === extensionState.currentUser.toLowerCase()) {
       chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
         const riotData = data.eloward_persistent_riot_user_data;
         
         if (riotData?.rankInfo) {
           const userRankData = {
             tier: riotData.rankInfo.tier,
             division: riotData.rankInfo.rank,
             leaguePoints: riotData.rankInfo.leaguePoints,
             summonerName: riotData.gameName
           };
           
           chrome.runtime.sendMessage({
             action: 'set_rank_data',
             username: username,
             rankData: userRankData
           });
           
           if (extensionState.channelName) {
             chrome.runtime.sendMessage({
               action: 'increment_db_reads',
               channel: extensionState.channelName
             });
             
             chrome.runtime.sendMessage({
               action: 'increment_successful_lookups',
               channel: extensionState.channelName
             });
           }
           
           addBadgeToMessage(usernameElement, userRankData);
         }
       });
       return;
     }
     
     // Fetch rank for other users
     fetchRankFromBackground(username, usernameElement);
   } catch (error) {
     console.log(`❌ EloWard: Error processing message:`, error);
   }
}

/**
 * Fetch rank data from background script
 */
function fetchRankFromBackground(username, usernameElement, messageElement = null) {
  if (extensionState.channelName) {
    chrome.runtime.sendMessage({
      action: 'increment_db_reads',
      channel: extensionState.channelName
    });
  }

  chrome.runtime.sendMessage({
    action: 'fetch_rank_for_username',
    username: username,
    channel: extensionState.channelName
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log(`❌ EloWard: Runtime error fetching rank:`, chrome.runtime.lastError);
      return;
    }
    
    if (response?.success && response.rankData) {
      if (extensionState.channelName) {
        chrome.runtime.sendMessage({
          action: 'increment_successful_lookups',
          channel: extensionState.channelName
        });
      }

      // Handle badge addition based on chat mode and available elements
      if (extensionState.chatMode === 'seventv' && messageElement) {
        addBadgeToSevenTVMessage(messageElement, usernameElement, response.rankData);
      } else {
        addBadgeToMessage(usernameElement, response.rankData);
      }
    }
  });
}

/**
 * Add rank badge to chat message with enhanced compatibility
 */
function addBadgeToMessage(usernameElement, rankData) {
  if (!rankData?.tier) return;
  
  try {
    // Get message container using mode-specific selectors
    const currentSelectors = SELECTORS[extensionState.chatMode];
    const messageContainer = usernameElement.closest(currentSelectors.message.join(', '));
    
    if (!messageContainer) {
      console.log(`❌ EloWard: Could not find message container in ${extensionState.chatMode} mode`);
      return;
    }
    
    // Check if badge already exists
    if (messageContainer.querySelector('.eloward-rank-badge')) return;
    
    // Handle based on chat mode
    switch (extensionState.chatMode) {
      case 'seventv':
        addBadgeToSevenTVMessage(messageContainer, usernameElement, rankData);
        break;
      case 'ffz':
        addBadgeToFFZMessage(messageContainer, usernameElement, rankData);
        break;
      default:
        addBadgeToStandardMessage(messageContainer, usernameElement, rankData);
        break;
    }
  } catch (error) {
    console.log(`❌ EloWard: Error adding badge:`, error);
  }
}

function addBadgeToSevenTVMessage(messageContainer, usernameElement, rankData) {
  // Find or create 7TV badge list container
  let badgeList = messageContainer.querySelector('.seventv-chat-user-badge-list');
  
  if (!badgeList) {
    const chatUser = messageContainer.querySelector('.seventv-chat-user');
    if (!chatUser) return;
    
    // Create badge list container
    badgeList = document.createElement('span');
    badgeList.className = 'seventv-chat-user-badge-list';
    
    // Insert before username
    const username = chatUser.querySelector('.seventv-chat-user-username');
    if (username) {
      chatUser.insertBefore(badgeList, username);
    } else {
      chatUser.insertBefore(badgeList, chatUser.firstChild);
    }
  }

  // Check if badge already exists
  if (badgeList.querySelector('.eloward-rank-badge')) {
    return;
  }
  
  // Create 7TV-style badge
  const badge = document.createElement('div');
  badge.className = 'seventv-chat-badge eloward-rank-badge seventv-integration';
  badge.dataset.rankText = formatRankText(rankData);
  
  const img = document.createElement('img');
  img.alt = rankData.tier;
  img.className = 'eloward-badge-img seventv-badge-img';
  img.src = `https://eloward-cdn.unleashai.workers.dev/lol/${rankData.tier.toLowerCase()}.png`;
  
  badge.appendChild(img);
  
  // Set data attributes for CSS styling and tooltip
  badge.dataset.rank = rankData.tier.toLowerCase();
  badge.dataset.division = rankData.division || '';
  badge.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                     rankData.leaguePoints.toString() : '';
  badge.dataset.username = rankData.summonerName || '';
  
  // Setup 7TV-specific tooltip
  badge.addEventListener('mouseenter', (e) => showSevenTVTooltip(e, rankData));
  badge.addEventListener('mouseleave', () => hideSevenTVTooltip());
  
  badgeList.appendChild(badge);
  
  console.log(`✅ EloWard: 7TV badge added for ${usernameElement.textContent} (${rankData.tier})`);
}

/**
 * Show 7TV-style tooltip 
 */
function showSevenTVTooltip(event, rankData) {
  hideSevenTVTooltip();
  
  if (!rankData?.tier) return;
  
  const tooltip = document.createElement('div');
  tooltip.className = 'eloward-7tv-tooltip';
  tooltip.id = 'eloward-7tv-tooltip-active';
  
  const tooltipBadge = document.createElement('img');
  tooltipBadge.className = 'eloward-7tv-tooltip-badge';
  tooltipBadge.src = `https://eloward-cdn.unleashai.workers.dev/lol/${rankData.tier.toLowerCase()}.png`;
  tooltipBadge.alt = 'Rank Badge';
  
  const tooltipText = document.createElement('div');
  tooltipText.className = 'eloward-7tv-tooltip-text';
  tooltipText.textContent = formatRankText(rankData);
  
  tooltip.appendChild(tooltipBadge);
  tooltip.appendChild(tooltipText);
  
  const rect = event.target.getBoundingClientRect();
  const badgeCenter = rect.left + (rect.width / 2);
  
  tooltip.style.left = `${badgeCenter}px`;
  tooltip.style.top = `${rect.top - 5}px`;
  
  document.body.appendChild(tooltip);
}

/**
 * Hide 7TV-style tooltip
 */
function hideSevenTVTooltip() {
  const existingTooltip = document.getElementById('eloward-7tv-tooltip-active');
  if (existingTooltip && existingTooltip.parentNode) {
    existingTooltip.remove();
  }
}

function addBadgeToFFZMessage(messageContainer, usernameElement, rankData) {
  const insertionPoint = findBadgeInsertionPoint(messageContainer, usernameElement);
  if (!insertionPoint.container) return;
  
  const badge = createBadgeElement(rankData, 24); // Use same size as standard
  badge.classList.add('ffz-badge');
  
  // Insert badge with error handling (same as standard)
  try {
    if (insertionPoint.before && insertionPoint.container.contains(insertionPoint.before)) {
      insertionPoint.container.insertBefore(badge, insertionPoint.before);
    } else {
      insertionPoint.container.appendChild(badge);
    }
    console.log(`✅ EloWard: FFZ badge added for ${usernameElement.textContent} (${rankData.tier})`);
  } catch (error) {
    console.log(`❌ EloWard: Failed to insert FFZ badge, trying fallback for ${usernameElement.textContent}:`, error.message);
    
    // Fallback: try to insert at the beginning of the message container
    try {
      messageContainer.insertAdjacentElement('afterbegin', badge);
      console.log(`✅ EloWard: FFZ badge added (fallback) for ${usernameElement.textContent} (${rankData.tier})`);
    } catch (fallbackError) {
      console.log(`❌ EloWard: FFZ fallback insertion also failed for ${usernameElement.textContent}:`, fallbackError.message);
    }
  }
}

function addBadgeToStandardMessage(messageContainer, usernameElement, rankData) {
  const insertionPoint = findBadgeInsertionPoint(messageContainer, usernameElement);
  if (!insertionPoint.container) return;
  
  const badge = createBadgeElement(rankData, 24); // 24px for standard badges
  
  // Insert badge with error handling
  try {
    if (insertionPoint.before && insertionPoint.container.contains(insertionPoint.before)) {
      insertionPoint.container.insertBefore(badge, insertionPoint.before);
    } else {
      insertionPoint.container.appendChild(badge);
    }
    console.log(`✅ EloWard: Standard badge added for ${usernameElement.textContent} (${rankData.tier})`);
  } catch (error) {
    console.log(`❌ EloWard: Failed to insert badge, trying fallback for ${usernameElement.textContent}:`, error.message);
    
    // Fallback: try to insert at the beginning of the message container
    try {
      messageContainer.insertAdjacentElement('afterbegin', badge);
      console.log(`✅ EloWard: Standard badge added (fallback) for ${usernameElement.textContent} (${rankData.tier})`);
    } catch (fallbackError) {
      console.log(`❌ EloWard: Fallback insertion also failed for ${usernameElement.textContent}:`, fallbackError.message);
    }
  }
}

/**
 * Find the best insertion point for the badge considering FFZ/7TV modifications
 */
function findBadgeInsertionPoint(messageContainer, usernameElement) {
  // Try to find the best place to insert the badge
  // Fix: Make sure the insertion point is valid for DOM manipulation
  
  if (!usernameElement) {
    return { container: null, before: null };
  }
  
  // Option 1: Try to find the direct parent that can hold badges
  const authorContainer = usernameElement.closest('.chat-author');
  if (authorContainer && messageContainer.contains(authorContainer)) {
    return { container: authorContainer, before: usernameElement };
  }
  
  // Option 2: Use the username element's direct parent
  const parent = usernameElement.parentElement;
  if (parent && messageContainer.contains(parent)) {
    return { container: parent, before: usernameElement };
  }
  
  // Option 3: Fallback - insert at the beginning of message container
  if (messageContainer) {
    return { container: messageContainer, before: messageContainer.firstElementChild };
  }
  
  return { container: null, before: null };
}

/**
 * Format rank text for display
 */
function formatRankText(rankData) {
  if (!rankData || !rankData.tier || rankData.tier.toUpperCase() === 'UNRANKED') {
    return 'UNRANKED';
  }
  
  let rankText = rankData.tier;
  
  if (rankData.division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier.toUpperCase())) {
    rankText += ' ' + rankData.division;
  }
  
  if (rankData.tier.toUpperCase() !== 'UNRANKED' && 
      rankData.leaguePoints !== undefined && 
      rankData.leaguePoints !== null) {
    rankText += ' - ' + rankData.leaguePoints + ' LP';
  }
  
  if (rankData.summonerName) {
    rankText += ` (${rankData.summonerName})`;
  }
  
  return rankText;
}

/**
 * Show tooltip on badge hover
 */
function showTooltip(event) {
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
  }

  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'eloward-tooltip';
    document.body.appendChild(tooltipElement);
  }
  
  const badge = event.currentTarget;
  const rankTier = badge.dataset.rank || 'UNRANKED';
  const division = badge.dataset.division || '';
  let lp = badge.dataset.lp || '';
  
  if (lp && !isNaN(Number(lp))) {
    lp = Number(lp).toString();
  }
  
  // Clear existing content
  tooltipElement.innerHTML = '';
  
  // Create and add larger rank badge image
  const tooltipBadge = document.createElement('img');
  tooltipBadge.className = 'eloward-tooltip-badge';
  
  // Get the rank badge image source from the original badge
  const originalImg = badge.querySelector('img');
  if (originalImg && originalImg.src) {
    tooltipBadge.src = originalImg.src;
    tooltipBadge.alt = 'Rank Badge';
  }
  
  tooltipElement.appendChild(tooltipBadge);
  
  // Create and add rank text
  const tooltipText = document.createElement('div');
  tooltipText.className = 'eloward-tooltip-text';
  
  // Format tooltip text
  if (!rankTier || rankTier.toUpperCase() === 'UNRANKED') {
    tooltipText.textContent = 'Unranked';
  } else {
    let formattedTier = rankTier.toLowerCase();
    formattedTier = formattedTier.charAt(0).toUpperCase() + formattedTier.slice(1);
    
    let rankText = formattedTier;
    
    if (division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankTier.toUpperCase())) {
      rankText += ' ' + division;
    }
    
    if (lp !== undefined && lp !== null && lp !== '') {
      rankText += ' - ' + lp + ' LP';
    }
    
    tooltipText.textContent = rankText;
  }
  
  tooltipElement.appendChild(tooltipText);
  
  // Position and show tooltip immediately
  const rect = badge.getBoundingClientRect();
  const badgeCenter = rect.left + (rect.width / 2);
  
  tooltipElement.style.left = `${badgeCenter}px`;
  tooltipElement.style.top = `${rect.top - 5}px`;
  tooltipElement.classList.add('visible');
}

/**
 * Hide tooltip
 */
function hideTooltip() {
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
    tooltipShowTimeout = null;
  }
  
  if (tooltipElement && tooltipElement.classList.contains('visible')) {
    tooltipElement.classList.remove('visible');
  }
}

/**
 * Add CSS styles for rank badges and tooltips - with rank-specific positioning
 */
function addExtensionStyles() {
  if (document.querySelector('#eloward-extension-styles')) return;
  
  const styleElement = document.createElement('style');
  styleElement.id = 'eloward-extension-styles';
  
  // Generate dynamic CSS based on current chat mode and rank data
  styleElement.textContent = generateRankSpecificCSS();
  
  document.head.appendChild(styleElement);
}

/**
 * Generate rank-specific CSS for both standard and 7TV modes
 */
function generateRankSpecificCSS() {
  let css = `
    /* Base Badge Styles */
    .eloward-rank-badge {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      position: relative !important;
      z-index: 10 !important;
      box-sizing: content-box !important;
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none !important;
      vertical-align: middle !important;
    }
    
    .eloward-badge-img {
      display: block !important;
      object-fit: contain !important;
    }
  `;

  // Generate standard mode rank-specific styles
  for (const tier of RANK_TIERS) {
    const styles = RANK_STYLES.standard[tier];
    if (styles) {
      css += `
        .eloward-rank-badge[data-rank="${tier}"] {
          width: ${styles.width} !important;
          height: ${styles.height} !important;
          margin: ${styles.margin} !important;
        }
        
        .eloward-rank-badge[data-rank="${tier}"] .eloward-badge-img {
          width: ${styles.width} !important;
          height: ${styles.height} !important;
        }
      `;
    }
  }

  // Generate 7TV mode rank-specific styles
  css += `
    /* 7TV Integration Base Styles */
    .seventv-chat-badge.eloward-rank-badge.seventv-integration {
      display: inline-block !important;
      vertical-align: middle !important;
      position: relative !important;
      border-radius: 4px !important;
      overflow: hidden !important;
    }

    .seventv-badge-img, .eloward-badge-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: contain !important;
      display: block !important;
    }

    .seventv-chat-user-badge-list {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      margin-right: 8px !important;
    }

    /* Responsive 7TV styling */
    @media (max-width: 400px) {
      .seventv-chat-badge.eloward-rank-badge.seventv-integration {
        width: 20px !important;
        height: 20px !important;
        margin: 0 2px 0 0 !important;
      }
    }

    /* Theme-specific 7TV styling */
    .tw-root--theme-dark .seventv-chat-badge.eloward-rank-badge.seventv-integration {
      filter: brightness(0.95) !important;
    }

    .tw-root--theme-light .seventv-chat-badge.eloward-rank-badge.seventv-integration {
      filter: brightness(1.05) contrast(1.1) !important;
    }
  `;

  // Generate 7TV rank-specific styles
  for (const tier of RANK_TIERS) {
    const styles = RANK_STYLES.seventv[tier];
    if (styles) {
      css += `
        .seventv-chat-badge.eloward-rank-badge.seventv-integration[data-rank="${tier}"] {
          width: ${styles.width} !important;
          height: ${styles.height} !important;
          margin: ${styles.margin} !important;
        }
      `;
    }
  }

  // Add 7TV username spacing and tooltip styles
  css += `
    /* 7TV username spacing adjustment */
    .seventv-chat-user .seventv-chat-user-badge-list + .seventv-chat-user-username {
      margin-left: 4px !important;
    }

    /* FFZ Compatibility */
    .ffz-chat .eloward-rank-badge {
      display: inline-flex !important;
      position: relative !important;
      z-index: 100 !important;
    }
    
    /* Tooltip Styles */
    .eloward-tooltip {
      position: absolute !important;
      z-index: 99999 !important;
      pointer-events: none !important;
      transform: translate(-50%, -100%) !important;
      font-family: Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      padding: 8px !important;
      border-radius: 8px !important;
      opacity: 0 !important;
      visibility: hidden !important;
      text-align: center !important;
      border: none !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
      margin-top: -8px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 6px !important;
    }
    
    .eloward-tooltip.visible {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translate(-50%, -100%) !important;
    }
    
    .eloward-tooltip-badge {
      width: 90px !important;
      height: 90px !important;
      object-fit: contain !important;
      display: block !important;
    }
    
    .eloward-tooltip-text {
      font-size: 13px !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
      white-space: nowrap !important;
    }
    
    .eloward-tooltip::after {
      content: "" !important;
      position: absolute !important;
      bottom: -4px !important;
      left: 50% !important;
      margin-left: -4px !important;
      border-width: 4px 4px 0 4px !important;
      border-style: solid !important;
    }
    
    /* 7TV Tooltip Styles */
    .eloward-7tv-tooltip {
      position: absolute !important;
      z-index: 99999 !important;
      pointer-events: none !important;
      transform: translate(-50%, -100%) !important;
      font-family: Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      padding: 8px !important;
      border-radius: 8px !important;
      text-align: center !important;
      border: none !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
      margin-top: -8px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 6px !important;
    }
    
    .eloward-7tv-tooltip-badge {
      width: 90px !important;
      height: 90px !important;
      object-fit: contain !important;
      display: block !important;
    }
    
    .eloward-7tv-tooltip-text {
      font-size: 13px !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
      white-space: nowrap !important;
    }
    
    .eloward-7tv-tooltip::after {
      content: "" !important;
      position: absolute !important;
      bottom: -4px !important;
      left: 50% !important;
      margin-left: -4px !important;
      border-width: 4px 4px 0 4px !important;
      border-style: solid !important;
    }
    
    /* Theme-specific tooltip colors */
    html.tw-root--theme-dark .eloward-tooltip,
    .tw-root--theme-dark .eloward-tooltip,
    body[data-a-theme="dark"] .eloward-tooltip,
    body.dark-theme .eloward-tooltip,
    html.tw-root--theme-dark .eloward-7tv-tooltip,
    .tw-root--theme-dark .eloward-7tv-tooltip,
    body[data-a-theme="dark"] .eloward-7tv-tooltip,
    body.dark-theme .eloward-7tv-tooltip {
      color: #0e0e10 !important;
      background-color: white !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3) !important;
    }
    
    html.tw-root--theme-dark .eloward-tooltip::after,
    .tw-root--theme-dark .eloward-tooltip::after,
    body[data-a-theme="dark"] .eloward-tooltip::after,
    body.dark-theme .eloward-tooltip::after,
    html.tw-root--theme-dark .eloward-7tv-tooltip::after,
    .tw-root--theme-dark .eloward-7tv-tooltip::after,
    body[data-a-theme="dark"] .eloward-7tv-tooltip::after,
    body.dark-theme .eloward-7tv-tooltip::after {
      border-color: white transparent transparent transparent !important;
    }
    
    html.tw-root--theme-light .eloward-tooltip,
    .tw-root--theme-light .eloward-tooltip,
    body[data-a-theme="light"] .eloward-tooltip,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-tooltip,
    html.tw-root--theme-light .eloward-7tv-tooltip,
    .tw-root--theme-light .eloward-7tv-tooltip,
    body[data-a-theme="light"] .eloward-7tv-tooltip,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-7tv-tooltip {
      color: #efeff1 !important;
      background-color: #0e0e10 !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4) !important;
    }
    
    html.tw-root--theme-light .eloward-tooltip::after,
    .tw-root--theme-light .eloward-tooltip::after,
    body[data-a-theme="light"] .eloward-tooltip::after,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-tooltip::after,
    html.tw-root--theme-light .eloward-7tv-tooltip::after,
    .tw-root--theme-light .eloward-7tv-tooltip::after,
    body[data-a-theme="light"] .eloward-7tv-tooltip::after,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-7tv-tooltip::after {
      border-color: #0e0e10 transparent transparent transparent !important;
    }
  `;
  
  return css;
}

 