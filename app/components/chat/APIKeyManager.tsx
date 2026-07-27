import React, { useState, useEffect } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import type { ProviderInfo } from '~/types/model';
import Cookies from 'js-cookie';
import { authUserStore } from '~/lib/stores/auth';

interface APIKeyManagerProps {
  provider: ProviderInfo;
  apiKey: string;
  setApiKey: (key: string) => void;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
}

const apiKeyMemoizeCache: { [k: string]: Record<string, string> } = {};

export function getApiKeysFromCookies() {
  const storedApiKeys = Cookies.get('apiKeys');
  let parsedKeys: Record<string, string> = {};

  if (storedApiKeys) {
    parsedKeys = apiKeyMemoizeCache[storedApiKeys];

    if (!parsedKeys) {
      parsedKeys = apiKeyMemoizeCache[storedApiKeys] = JSON.parse(storedApiKeys);
    }
  }

  return parsedKeys;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const APIKeyManager: React.FC<APIKeyManagerProps> = ({ provider, apiKey, setApiKey }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);

  // Reset states and load saved key when provider changes
  useEffect(() => {
    // Load saved API key from cookies for this provider
    const savedKeys = getApiKeysFromCookies();
    const savedKey = savedKeys[provider.name] || '';

    setTempKey(savedKey);
    setApiKey(savedKey);
    setIsEditing(false);
  }, [provider.name]);

  const handleSave = () => {
    // Save to parent state
    setApiKey(tempKey);

    /*
     * Save to cookies — remove the key entry entirely when empty
     * so root.tsx can re-sync from Supabase on the next page load.
     */
    const currentKeys = getApiKeysFromCookies();

    if (tempKey) {
      const newKeys = { ...currentKeys, [provider.name]: tempKey };
      Cookies.set('apiKeys', JSON.stringify(newKeys));

      /*
       * If signed in, persist the key to the account (encrypted at rest) so it
       * syncs across devices and isn't re-entered each visit.
       */
      if (authUserStore.get()) {
        fetch('/api/account/api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: tempKey, provider: provider.name }),
        }).catch(() => {
          // best-effort; local cookie still holds the key
        });
      }
    } else {
      // Remove this provider's entry from the cookie instead of storing ""
      const { [provider.name]: _, ...remaining } = currentKeys;

      if (Object.keys(remaining).length > 0) {
        Cookies.set('apiKeys', JSON.stringify(remaining));
      } else {
        Cookies.remove('apiKeys');
      }

      // Also remove from server-side storage
      if (authUserStore.get()) {
        fetch('/api/account/api-key', {
          method: 'DELETE',
        }).catch(() => {
          // best-effort
        });
      }
    }

    setIsEditing(false);
  };

  return (
    <div className="flex items-center justify-between py-3 px-1">
      <div className="flex items-center gap-2 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-palmkit-elements-textSecondary">{provider?.name} API Key:</span>
          {!isEditing && (
            <div className="flex items-center gap-2">
              {apiKey ? (
                <>
                  <div className="i-ph:check-circle-fill text-green-500 w-4 h-4" />
                  <span className="text-xs text-green-500">Active</span>
                </>
              ) : (
                <>
                  <div className="i-ph:warning-circle-fill text-amber-500 w-4 h-4" />
                  <span className="text-xs text-amber-500">Not set — tap edit to add your key</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={tempKey}
              placeholder="Enter API Key"
              onChange={(e) => setTempKey(e.target.value)}
              className="w-[300px] px-3 py-1.5 text-sm rounded border border-palmkit-elements-borderColor 
                        bg-palmkit-elements-prompt-background text-palmkit-elements-textPrimary 
                        focus:outline-none focus:ring-2 focus:ring-palmkit-elements-focus"
            />
            <IconButton
              onClick={handleSave}
              title="Save API Key"
              className="bg-green-500/10 hover:bg-green-500/20 text-green-500"
            >
              <div className="i-ph:check w-4 h-4" />
            </IconButton>
            <IconButton
              onClick={() => setIsEditing(false)}
              title="Cancel"
              className="bg-red-500/10 hover:bg-red-500/20 text-red-500"
            >
              <div className="i-ph:x w-4 h-4" />
            </IconButton>
          </div>
        ) : (
          <>
            {
              <IconButton
                onClick={() => setIsEditing(true)}
                title="Edit API Key"
                className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-500"
              >
                <div className="i-ph:pencil-simple w-4 h-4" />
              </IconButton>
            }
            {provider?.getApiKeyLink && !apiKey && (
              <IconButton
                onClick={() => window.open(provider?.getApiKeyLink)}
                title="Get API Key"
                className="bg-gray-500/10 hover:bg-gray-500/20 text-gray-600 flex items-center gap-2"
              >
                <span className="text-xs whitespace-nowrap">{provider?.labelForGetApiKey || 'Get API Key'}</span>
                <div className={`${provider?.icon || 'i-ph:key'} w-4 h-4`} />
              </IconButton>
            )}
          </>
        )}
      </div>
    </div>
  );
};
