// API for Polkadot AssetHub (Subscan)

const polkadotAPI = (function () {
  "use strict";

  const SUBSCAN_API = "https://assethub-polkadot.api.subscan.io";
  const NETWORK = "assethub-polkadot";

  function normalizeAddress(address) {
    if (!address) return address;

    if (typeof polkadotCrypto !== "undefined" && polkadotCrypto.hexToSS58) {
      return polkadotCrypto.hexToSS58(address, 0);
    }

    // Fallback: return as-is
    return address;
  }

  async function getBalance(address) {
    try {
      const response = await fetch(`${SUBSCAN_API}/api/scan/account/tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "239a9db0f7174ad6a07ee6006dbb29a7", // Add API key if needed
        },
        body: JSON.stringify({
          address: address,
        }),
      });

      const data = await response.json();

      if (data.code === 0 && data.data) {
        // Find DOT balance
        const dotBalance = data.data.native?.find(
          (token) => token.symbol === "DOT"
        );

        return {
          balance: dotBalance
            ? parseFloat(dotBalance.balance) / Math.pow(10, dotBalance.decimals)
            : 0,
          address: address,
          decimals: dotBalance?.decimals || 10,
        };
      }

      throw new Error(data.message || "Failed to fetch balance");
    } catch (error) {
      console.error("Error fetching balance:", error);
      throw error;
    }
  }

  async function getTransactions(address, page = 0, limit = 20) {
    try {
      const response = await fetch(`${SUBSCAN_API}/api/v2/scan/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "239a9db0f7174ad6a07ee6006dbb29a7",
        },
        body: JSON.stringify({
          address: address,
          row: limit,
          page: page,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.code === 0 && data.data) {
        const transactions = data.data.transfers || [];

        return transactions.map((tx) => ({
          id: tx.hash,
          hash: tx.hash,
          from: normalizeAddress(tx.from),
          to: normalizeAddress(tx.to),
          amount: parseFloat(tx.amount || 0),
          amountDot: parseFloat(tx.amount || 0),
          fee: parseFloat(tx.fee || 0) / Math.pow(10, 10),
          feeDot: parseFloat(tx.fee || 0) / Math.pow(10, 10),
          block: tx.block_num,
          timestamp: tx.block_timestamp,
          success: tx.success,
          type: normalizeAddress(tx.from) === address ? "sent" : "received",
          module: tx.module,
          asset_symbol: tx.asset_symbol || "DOT",
          extrinsicIndex: tx.extrinsic_index,
        }));
      }

      throw new Error(data.message || "Failed to fetch transactions");
    } catch (error) {
      console.error("Error fetching transactions:", error);
      throw error;
    }
  }

  async function getTransaction(hash) {
    try {
      const response = await fetch(`${SUBSCAN_API}/api/scan/extrinsic`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "239a9db0f7174ad6a07ee6006dbb29a7", // Add API key if needed
        },
        body: JSON.stringify({
          hash: hash,
        }),
      });

      const data = await response.json();

      if (data.code === 0 && data.data) {
        const tx = data.data;

        // Extract sender address
        let from = tx.account_id || tx.account?.address || "";

        // Extract destination and amount based on transaction type
        let to = "";
        let amount = 0;

        // Check if it's a regular transfer with transfer object
        if (tx.transfer) {
          to = tx.transfer.to || tx.transfer.destination || "";
          // The transfer.amount is already in DOT (not planck), so use it directly
          amount = parseFloat(tx.transfer.amount) || 0;
        }
        // Check if it's a balance transfer without transfer object (data in params)
        else if (
          tx.params &&
          Array.isArray(tx.params) &&
          (tx.call_module === "balances" || tx.module === "balances")
        ) {
          // Find dest parameter
          const destParam = tx.params.find((p) => p.name === "dest");
          if (destParam && destParam.value) {
            // Try to get SS58 address first, fallback to hex Id
            to = destParam.value.address || destParam.value.Id || "";
          }

          // Find value parameter
          const valueParam = tx.params.find((p) => p.name === "value");
          if (valueParam && valueParam.value) {
            // Convert from planck to DOT (1 DOT = 10^10 planck)
            amount = parseFloat(valueParam.value) / Math.pow(10, 10);
          }
        }
        // Check if it's an XCM transfer
        else if (tx.params && Array.isArray(tx.params)) {
          // Find beneficiary parameter
          const beneficiaryParam = tx.params.find(
            (p) => p.name === "beneficiary"
          );
          if (beneficiaryParam && beneficiaryParam.value) {
            try {
              // Extract AccountId32 from nested structure
              const v3 = beneficiaryParam.value.V3 || beneficiaryParam.value.V4;

              if (v3 && v3.interior) {
                // Handle X1 as object or array
                let accountId32Data = null;

                if (v3.interior.X1) {
                  if (v3.interior.X1.AccountId32) {
                    accountId32Data = v3.interior.X1.AccountId32;
                  } else if (
                    Array.isArray(v3.interior.X1) &&
                    v3.interior.X1[0]?.AccountId32
                  ) {
                    accountId32Data = v3.interior.X1[0].AccountId32;
                  }
                }

                if (accountId32Data && accountId32Data.id) {
                  to = accountId32Data.id;
                }
              }
            } catch (e) {
              console.error("Failed to extract beneficiary:", e);
            }
          }

          // Find assets/amount parameter
          const assetsParam = tx.params.find(
            (p) => p.name === "assets" || p.name === "value"
          );
          if (assetsParam && assetsParam.value) {
            try {
              const v3 = assetsParam.value.V3 || assetsParam.value.V4;

              if (v3 && Array.isArray(v3) && v3.length > 0) {
                const asset = v3[0];
                const fungible = asset.fun?.Fungible || asset.amount?.Fungible;

                if (fungible) {
                  amount = parseFloat(fungible) / Math.pow(10, 10);
                }
              }
            } catch (e) {
              console.error("Failed to extract amount:", e);
            }
          }
        }

        // Fallback: If still no data, check events for Transfer
        if (!to && !amount && tx.event && Array.isArray(tx.event)) {
          const transferEvent = tx.event.find(
            (e) => e.module_id === "balances" && e.event_id === "Transfer"
          );
          if (transferEvent && transferEvent.params) {
            try {
              const eventParams = JSON.parse(transferEvent.params);

              // Find to and amount from event params
              const toParam = eventParams.find((p) => p.name === "to");
              const amountParam = eventParams.find((p) => p.name === "amount");

              if (toParam && toParam.value) {
                to = toParam.value;
              }

              if (amountParam && amountParam.value) {
                amount = parseFloat(amountParam.value) / Math.pow(10, 10);
              }
            } catch (e) {
              console.error("Failed to parse event params:", e);
            }
          }
        }

        // Normalize addresses (keep SS58 as-is, hex addresses remain valid for AssetHub)
        from = normalizeAddress(from);
        to = normalizeAddress(to);

        return {
          id: tx.extrinsic_hash,
          hash: tx.extrinsic_hash,
          from: from,
          to: to,
          amount: amount,
          amountDot: amount,
          fee: parseFloat(tx.fee || 0) / Math.pow(10, 10),
          feeDot: parseFloat(tx.fee || 0) / Math.pow(10, 10),
          block: tx.block_num,
          blockNum: tx.block_num,
          timestamp: tx.block_timestamp,
          success: tx.success,
          module: tx.call_module,
          method: tx.call_module_function,
          signature: tx.signature,
        };
      }

      throw new Error(data.message || "Transaction not found");
    } catch (error) {
      console.error("Error fetching transaction:", error);
      throw error;
    }
  }

  // Build and sign transaction using direct crypto (no full API needed)
  async function buildAndSignTransaction(txParams) {
    const { sourceAddress, destinationAddress, amount, privateKeyHex, memo } =
      txParams;

    try {
      // Wait for crypto to be ready
      const { cryptoWaitReady, sr25519PairFromSeed, sr25519Sign } =
        window.polkadotUtilCrypto || {};
      if (!cryptoWaitReady) {
        throw new Error(
          "Polkadot crypto utilities not loaded. Please refresh the page."
        );
      }
      await cryptoWaitReady();

      // Convert hex private key to seed (first 32 bytes)
      const privKeyOnly = privateKeyHex.substring(0, 64);
      const { hexToU8a, u8aToHex } = window.polkadotUtil || {};
      if (!hexToU8a) {
        throw new Error(
          "Polkadot utilities not loaded. Please refresh the page."
        );
      }
      const seed = hexToU8a("0x" + privKeyOnly).slice(0, 32);

      // Create keypair from seed using Sr25519
      const keypair = sr25519PairFromSeed(seed);

      // Get address from public key
      const { encodeAddress } = window.polkadotUtilCrypto;
      const address = encodeAddress(keypair.publicKey, 0); // 0 = Polkadot prefix

      // Convert amount to planck (1 DOT = 10^10 planck)
      const amountInPlanck = Math.floor(parseFloat(amount) * Math.pow(10, 10));

      // Estimated fee
      const estimatedFee = 0.0165;

      // Return transaction data for RPC submission
      return {
        keypair: keypair,
        destinationAddress: destinationAddress,
        amountInPlanck: amountInPlanck,
        fee: estimatedFee,
        feeDot: estimatedFee,
        sourceAddress: sourceAddress,
      };
    } catch (error) {
      console.error("Error building transaction:", error);
      throw error;
    }
  }

  // Submit transaction using Polkadot.js API
  async function submitTransaction(txData) {
    try {
      const { keypair, destinationAddress, amountInPlanck, sourceAddress } =
        txData;

      // Check if API is available
      if (
        !window.polkadotApi ||
        !window.polkadotApi.ApiPromise ||
        !window.polkadotApi.WsProvider
      ) {
        throw new Error("Polkadot API not loaded! Please refresh the page.");
      }

      const { ApiPromise, WsProvider } = window.polkadotApi;
      const rpcUrl = "wss://polkadot-asset-hub-rpc.polkadot.io";

      // Create API instance
      const provider = new WsProvider(rpcUrl);
      const api = await ApiPromise.create({ provider });

      // Get account nonce
      const nonce = await api.rpc.system.accountNextIndex(sourceAddress);

      const transfer = api.tx.balances.transferAllowDeath(
        destinationAddress,
        amountInPlanck
      );

      // Create a Keyring and add our keypair
      // The Polkadot API needs a proper KeyringPair interface
      // Our keypair from sr25519PairFromSeed has the right structure, but we need to add the sign method
      const { u8aToHex } = window.polkadotUtil;
      const signerPair = {
        address: keypair.address,
        addressRaw: keypair.publicKey,
        publicKey: keypair.publicKey,
        sign: (data) => {
          const { sr25519Sign } = window.polkadotUtilCrypto;
          const signature = sr25519Sign(data, keypair);
          // Return signature with proper format for Sr25519: { sr25519: Uint8Array }
          return { sr25519: signature };
        },
        type: "sr25519",
        unlock: () => {}, // Required but unused for our case
        lock: () => {}, // Required but unused for our case
        isLocked: false,
      };

      return new Promise((resolve, reject) => {
        let unsub;
        const timeout = setTimeout(() => {
          if (unsub) unsub();
          api.disconnect();
          reject(new Error("Transaction timeout"));
        }, 60000);

        transfer
          .signAndSend(signerPair, { nonce }, (result) => {
            if (result.status.isFinalized) {
              clearTimeout(timeout);

              // Check for errors
              const failed = result.events.find(({ event }) =>
                api.events.system.ExtrinsicFailed.is(event)
              );

              if (failed) {
                const [dispatchError] = failed.event.data;
                let errorMessage = "Transaction failed";

                if (dispatchError.isModule) {
                  try {
                    const decoded = api.registry.findMetaError(
                      dispatchError.asModule
                    );
                    errorMessage = `${decoded.section}.${
                      decoded.name
                    }: ${decoded.docs.join(" ")}`;
                  } catch (e) {
                    errorMessage = `Module error: ${dispatchError.asModule.toHuman()}`;
                  }
                } else if (dispatchError.isToken) {
                  errorMessage = `Token error: ${dispatchError.asToken.toString()}`;
                } else if (dispatchError.isArithmetic) {
                  errorMessage = `Arithmetic error: ${dispatchError.asArithmetic.toString()}`;
                }

                console.error(`❌ Transaction failed: ${errorMessage}`);
                if (unsub) unsub();
                api.disconnect();
                reject(new Error(errorMessage));
              } else {
                const txHash = transfer.hash.toHex();
                console.log(`✅ Transaction successful! Hash: ${txHash}`);

                if (unsub) unsub();
                api.disconnect();
                resolve({
                  hash: txHash,
                  success: true,
                  block: result.status.asFinalized.toHex(),
                });
              }
            }
          })
          .then((unsubscribe) => {
            unsub = unsubscribe;
          })
          .catch((error) => {
            clearTimeout(timeout);
            console.error(`❌ Signing/sending error: ${error.message}`);
            api.disconnect();
            reject(error);
          });
      });
    } catch (error) {
      console.error("❌ Error submitting transaction:", error);
      throw error;
    }
  }

  // Estimate transaction fee using Polkadot API paymentInfo
  async function estimateFee(sourceAddress, destinationAddress, amount) {
    try {
      // Check if API is available
      if (
        !window.polkadotApi ||
        !window.polkadotApi.ApiPromise ||
        !window.polkadotApi.WsProvider
      ) {
        console.warn("Polkadot API not loaded, using default fee estimate");
        return {
          fee: 0.0165,
          feeDot: 0.0165,
        };
      }

      const { ApiPromise, WsProvider } = window.polkadotApi;
      const rpcUrl = "wss://polkadot-asset-hub-rpc.polkadot.io";

      // Create API instance
      const provider = new WsProvider(rpcUrl);
      const api = await ApiPromise.create({ provider });

      // Convert amount to planck
      const amountInPlanck = Math.floor(parseFloat(amount) * Math.pow(10, 10));

      // Create the transfer transaction
      const transfer = api.tx.balances.transferAllowDeath(
        destinationAddress,
        amountInPlanck
      );

      // Get payment info (accurate fee estimation)
      const paymentInfo = await transfer.paymentInfo(sourceAddress);

      // Disconnect after getting fee
      await api.disconnect();

      // Convert fee from planck to DOT
      const fee =
        parseFloat(paymentInfo.partialFee.toString()) / Math.pow(10, 10);

      return {
        fee: fee,
        feeDot: fee,
      };
    } catch (error) {
      console.error("Error estimating fee:", error);
      // Return typical DOT transfer fee if estimation fails
      return {
        fee: 0.0165,
        feeDot: 0.0165,
      };
    }
  }

  // Check if account is active (has balance)
  async function checkAccountActive(address) {
    try {
      const balanceData = await getBalance(address);
      return {
        isActive: balanceData.balance > 0,
        balance: balanceData.balance,
        minimumRequired: 0.01, // Minimum to activate new account
      };
    } catch (error) {
      console.error("Error checking account status:", error);
      // If we can't check, assume account needs activation
      return {
        isActive: false,
        balance: 0,
        minimumRequired: 0.01,
      };
    }
  }

  // Public API
  return {
    getBalance,
    getTransactions,
    getTransaction,
    buildAndSignTransaction,
    submitTransaction,
    estimateFee,
    checkAccountActive,
    SUBSCAN_API,
    NETWORK,
  };
})();
