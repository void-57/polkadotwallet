// Search database using local storage

class PolkadotSearchDB {
  constructor() {
    this.dbName = "PolkadotWalletDB";
    this.storeName = "recentSearches";
    this.maxSearches = 10;
  }

  saveSearch(address, balance, sourceInfo = null) {
    try {
      const searches = this.getSearches();

      // Check if address already exists
      const existingIndex = searches.findIndex((s) => s.address === address);
      const existing = existingIndex !== -1 ? searches[existingIndex] : null;

      const searchData = {
        address: address,
        balance: balance || 0,
        timestamp: Date.now(),
        date: new Date().toISOString(),
        btcAddress: sourceInfo?.btcAddress || existing?.btcAddress || null,
        floAddress: sourceInfo?.floAddress || existing?.floAddress || null,
        isFromPrivateKey: !!(
          sourceInfo?.btcAddress ||
          sourceInfo?.floAddress ||
          existing?.btcAddress ||
          existing?.floAddress
        ),
      };

      if (existingIndex !== -1) {
        searches[existingIndex] = searchData;
      } else {
        // Add new search at the beginning
        searches.unshift(searchData);

        // Keep only the most recent searches
        if (searches.length > this.maxSearches) {
          searches.pop();
        }
      }

      localStorage.setItem(this.storeName, JSON.stringify(searches));
      return true;
    } catch (error) {
      console.error("Error saving search:", error);
      return false;
    }
  }

  getSearches() {
    try {
      const data = localStorage.getItem(this.storeName);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error("Error getting searches:", error);
      return [];
    }
  }

  getSearch(address) {
    try {
      const searches = this.getSearches();
      return searches.find((s) => s.address === address) || null;
    } catch (error) {
      console.error("Error getting search:", error);
      return null;
    }
  }

  deleteSearch(address) {
    try {
      const searches = this.getSearches();
      const filtered = searches.filter((s) => s.address !== address);
      localStorage.setItem(this.storeName, JSON.stringify(filtered));
      return true;
    } catch (error) {
      console.error("Error deleting search:", error);
      return false;
    }
  }

  clearAll() {
    try {
      localStorage.removeItem(this.storeName);
      return true;
    } catch (error) {
      console.error("Error clearing searches:", error);
      return false;
    }
  }

  getRecentSearches(limit = null) {
    try {
      let searches = this.getSearches();

      // Sort by timestamp descending (newest first)
      searches.sort((a, b) => b.timestamp - a.timestamp);

      // Apply limit if specified
      if (limit && limit > 0) {
        searches = searches.slice(0, limit);
      }

      return searches;
    } catch (error) {
      console.error("Error getting recent searches:", error);
      return [];
    }
  }

  updateBalance(address, newBalance) {
    try {
      const searches = this.getSearches();
      const index = searches.findIndex((s) => s.address === address);

      if (index !== -1) {
        searches[index].balance = newBalance;
        searches[index].timestamp = Date.now();
        searches[index].date = new Date().toISOString();
        localStorage.setItem(this.storeName, JSON.stringify(searches));
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error updating balance:", error);
      return false;
    }
  }
}

// Create a global instance if SearchedAddressDB is referenced anywhere
const SearchedAddressDB = PolkadotSearchDB;
