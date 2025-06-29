// Main content script that runs on Twitter/X pages

// Configuration
const CONFIG = {
  // Selectors for Twitter/X post elements
  SELECTORS: {
    POST: 'article[data-testid="tweet"], article[data-testid="tweetDetail"]',
    POST_TEXT: 'div[data-testid="tweetText"]',
    POST_AUTHOR: 'div[data-testid="User-Name"] a[role="link"]:last-child',
    REPLY_BUTTON: 'div[role="button"][data-testid="reply"], [data-testid="reply"]',
    REPLY_BOX: 'div[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_0"]',
  },
  BUTTON_CLASS: 'ai-reply-btn',
  BUTTON_LOADING_CLASS: 'ai-reply-btn-loading',
  BUTTON_TEXT: '🤖 AI Reply',
  BUTTON_LOADING_TEXT: 'Generating...',
};

// Add AI reply button to each post
function addAIReplyButton(postElement) {
  // Skip if button already exists
  if (postElement.querySelector(`.${CONFIG.BUTTON_CLASS}`)) return;
  
  // Find the reply button container
  const replyButton = postElement.querySelector(CONFIG.SELECTORS.REPLY_BUTTON);
  if (!replyButton) return;
  
  // Create AI reply button
  const aiButton = document.createElement('div');
  aiButton.className = CONFIG.BUTTON_CLASS;
  aiButton.textContent = CONFIG.BUTTON_TEXT;
  
  // Position the button next to the reply button
  const buttonContainer = replyButton.parentElement;
  if (buttonContainer) {
    buttonContainer.parentNode.insertBefore(aiButton, buttonContainer.nextSibling);
  } else {
    replyButton.parentNode.appendChild(aiButton);
  }
  
  // Add click handler
  aiButton.addEventListener('click', (e) => {
    e.stopPropagation();
    handleAIReplyClick(postElement, aiButton);
  });
}

// Handle AI reply button click
async function handleAIReplyClick(postElement, button) {
  try {
    // Show loading state
    button.classList.add(CONFIG.BUTTON_LOADING_CLASS);
    button.textContent = CONFIG.BUTTON_LOADING_TEXT;
    
    // Get post content and author
    const postTextElement = postElement.querySelector(CONFIG.SELECTORS.POST_TEXT);
    const authorElement = postElement.querySelector(CONFIG.SELECTORS.POST_AUTHOR);
    
    if (!postTextElement) {
      throw new Error('Could not find post text');
    }
    
    const postText = postTextElement.textContent.trim();
    const author = authorElement ? authorElement.textContent.trim() : 'the author';
    
    // Get API key and tone from storage
    chrome.storage.sync.get(['geminiApiKey', 'tone'], async (result) => {
      try {
        const apiKey = result.geminiApiKey;
        const tone = result.tone || 'friendly'; // Default to 'friendly' if not set
        
        if (!apiKey) {
          throw new Error('Please set your Gemini API key in the extension settings.');
        }
        
        // Generate AI reply with tone
        const reply = await generateAIReply(postText, author, apiKey, tone);
        
        // Find and click the reply button to open the reply box
        const replyButton = postElement.querySelector(CONFIG.SELECTORS.REPLY_BUTTON);
        if (replyButton) {
          replyButton.click();
          
          // Wait for the reply box to appear and insert the generated text
          setTimeout(() => {
            const replyBox = document.querySelector(CONFIG.SELECTORS.REPLY_BOX);
            if (replyBox) {
              replyBox.focus();
              document.execCommand('insertText', false, reply);
            }
          }, 300);
        }
      } catch (error) {
        console.error('Error generating AI reply:', error);
        alert(`Error: ${error.message}`);
      } finally {
        // Reset button state
        button.classList.remove(CONFIG.BUTTON_LOADING_CLASS);
        button.textContent = CONFIG.BUTTON_TEXT;
      }
    });
  } catch (error) {
    console.error('Error handling AI reply click:', error);
    alert(`Error: ${error.message}`);
    button.classList.remove(CONFIG.BUTTON_LOADING_CLASS);
    button.textContent = CONFIG.BUTTON_TEXT;
  }
}

// Generate AI reply using Gemini 2.0 Flash API with tone
async function generateAIReply(postText, author, apiKey, tone = 'friendly') {
  // Define tone instructions
  const toneInstructions = {
    'casual': 'Use a casual, conversational tone as if talking to a friend. Feel free to use contractions and informal language.',
    'professional': 'Use a professional and polished tone suitable for business or formal communication. Be clear and concise.',
    'friendly': 'Use a warm and approachable tone. Be polite and engaging.',
    'enthusiastic': 'Use an excited and energetic tone with positive language and exclamation points! Show enthusiasm!',
    'witty': 'Be clever and humorous. Include a touch of wit or a playful remark if appropriate.',
    'formal': 'Use a very formal and respectful tone, suitable for professional or official communication.'
  };

  const toneInstruction = toneInstructions[tone] || toneInstructions['friendly'];

  const prompt = `Write a thoughtful, engaging, and concise reply to ${author}'s post on X (Twitter). 

Tone: ${toneInstruction}

Post: "${postText}"

Reply (keep it under 280 characters, be natural and authentic):`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'You are a helpful assistant that writes engaging and authentic social media replies. Keep responses concise, natural, and under 280 characters.' },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
          topP: 0.8,
          topK: 40
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to generate reply');
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Sorry, I could not generate a reply.';
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw new Error(`Failed to generate reply: ${error.message}`);
  }
}

// Initialize MutationObserver to handle dynamically loaded content
function initObserver() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Check if the node is a post or contains posts
          if (node.matches(CONFIG.SELECTORS.POST)) {
            addAIReplyButton(node);
          } else {
            const posts = node.querySelectorAll ? node.querySelectorAll(CONFIG.SELECTORS.POST) : [];
            posts.forEach(post => addAIReplyButton(post));
          }
        }
      });
    });
  });

  // Start observing the document with the configured parameters
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also check for existing posts on page load
  document.querySelectorAll(CONFIG.SELECTORS.POST).forEach(addAIReplyButton);
}

// Initialize the observer when the script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initObserver);
} else {
  initObserver();
}
