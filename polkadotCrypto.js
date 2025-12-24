(function (EXPORTS) {
  "use strict";
  const polkadotCrypto = EXPORTS;

  function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function generateNewID() {
    var key = new Bitcoin.ECKey(false);
    key.setCompressed(true);
    return {
      floID: key.getBitcoinAddress(),
      pubKey: key.getPubKeyHex(),
      privKey: key.getBitcoinWalletImportFormat(),
    };
  }

  const BASE58_ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  function base58Encode(bytes) {
    const digits = [0];

    for (let i = 0; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }

      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }

    // Add leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
      digits.push(0);
    }

    // Convert to string
    return digits
      .reverse()
      .map((d) => BASE58_ALPHABET[d])
      .join("");
  }

  function base58Decode(str) {
    const bytes = [0];

    for (let i = 0; i < str.length; i++) {
      const value = BASE58_ALPHABET.indexOf(str[i]);
      if (value === -1) {
        throw new Error(`Invalid Base58 character: ${str[i]}`);
      }

      let carry = value;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }

      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }

    // Add leading zeros
    for (let i = 0; i < str.length && str[i] === "1"; i++) {
      bytes.push(0);
    }

    return new Uint8Array(bytes.reverse());
  }

  function blake2bHash(data, outlen = 64) {
    if (typeof blakejs !== "undefined" && blakejs.blake2b) {
      return blakejs.blake2b(data, null, outlen);
    }
    throw new Error("Blake2b library not available");
  }

  function createPolkadotAddress(publicKey, ss58Prefix = 0) {
    // SS58 format: [prefix] + [public_key] + [checksum]
    const prefix = new Uint8Array([ss58Prefix]);
    const payload = new Uint8Array([...prefix, ...publicKey]);

    const checksumInput = new Uint8Array([
      ...new TextEncoder().encode("SS58PRE"),
      ...payload,
    ]);
    const hash = blake2bHash(checksumInput, 64);
    const checksum = hash.slice(0, 2);

    // Combine all parts
    const addressBytes = new Uint8Array([...payload, ...checksum]);

    return base58Encode(addressBytes);
  }

  // --- Multi-chain Generator (BTC, FLO, DOT) ---
  polkadotCrypto.generateMultiChain = async function (inputWif) {
    const versions = {
      BTC: { pub: 0x00, priv: 0x80 },
      FLO: { pub: 0x23, priv: 0xa3 },
    };

    const origBitjsPub = bitjs.pub;
    const origBitjsPriv = bitjs.priv;
    const origBitjsCompressed = bitjs.compressed;
    const origCoinJsCompressed = coinjs.compressed;

    bitjs.compressed = true;
    coinjs.compressed = true;

    let privKeyHex;
    let compressed = true;

    if (typeof inputWif === "string" && inputWif.trim().length > 0) {
      const trimmedInput = inputWif.trim();
      const hexOnly = /^[0-9a-fA-F]+$/.test(trimmedInput);

      // Check if it's a Polkadot seed phrase or private key
      if (
        hexOnly &&
        (trimmedInput.length === 64 || trimmedInput.length === 128)
      ) {
        privKeyHex =
          trimmedInput.length === 128
            ? trimmedInput.substring(0, 64)
            : trimmedInput;
      } else {
        try {
          const decode = Bitcoin.Base58.decode(trimmedInput);

          // Validate WIF checksum
          if (decode.length < 37) {
            throw new Error("Invalid WIF key: too short");
          }

          // WIF format: [version(1)] + [private_key(32)] + [compression_flag(0-1)] + [checksum(4)]
          const payload = decode.slice(0, decode.length - 4);
          const providedChecksum = decode.slice(decode.length - 4);

          // Calculate expected checksum using double SHA256
          const hash1 = Crypto.SHA256(payload, { asBytes: true });
          const hash2 = Crypto.SHA256(hash1, { asBytes: true });
          const expectedChecksum = hash2.slice(0, 4);

          // Verify checksum matches
          let checksumMatch = true;
          for (let i = 0; i < 4; i++) {
            if (providedChecksum[i] !== expectedChecksum[i]) {
              checksumMatch = false;
              break;
            }
          }

          if (!checksumMatch) {
            const providedHex = providedChecksum
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            const expectedHex = expectedChecksum
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            throw new Error(
              `Invalid WIF key: checksum mismatch (expected ${expectedHex}, got ${providedHex})`
            );
          }

          const keyWithVersion = decode.slice(0, decode.length - 4);
          let key = keyWithVersion.slice(1);
          if (key.length >= 33 && key[key.length - 1] === 0x01) {
            key = key.slice(0, key.length - 1);
            compressed = true;
          }
          privKeyHex = bytesToHex(key);
        } catch (e) {
          console.error("Invalid WIF key:", e.message);
          throw new Error(`Failed to recover from WIF key: ${e.message}`);
        }
      }
    } else {
      // Generate new key if no input
      const newKey = generateNewID();
      const decode = Bitcoin.Base58.decode(newKey.privKey);
      const keyWithVersion = decode.slice(0, decode.length - 4);
      let key = keyWithVersion.slice(1);
      if (key.length >= 33 && key[key.length - 1] === 0x01)
        key = key.slice(0, key.length - 1);
      privKeyHex = bytesToHex(key);
    }

    // --- Derive addresses for each chain ---
    const result = { BTC: {}, FLO: {}, DOT: {} };

    // BTC
    bitjs.pub = versions.BTC.pub;
    bitjs.priv = versions.BTC.priv;
    const pubKeyBTC = bitjs.newPubkey(privKeyHex);
    result.BTC.address = coinjs.bech32Address(pubKeyBTC).address;
    result.BTC.privateKey = bitjs.privkey2wif(privKeyHex);

    // FLO
    bitjs.pub = versions.FLO.pub;
    bitjs.priv = versions.FLO.priv;
    const pubKeyFLO = bitjs.newPubkey(privKeyHex);
    result.FLO.address = bitjs.pubkey2address(pubKeyFLO);
    result.FLO.privateKey = bitjs.privkey2wif(privKeyHex);

    // DOT (Polkadot) - Using Sr25519 with Polkadot.js
    try {
      const privBytes = hexToBytes(privKeyHex.substring(0, 64));
      const seed = new Uint8Array(privBytes.slice(0, 32));

      // Wait for Polkadot crypto to be ready
      await polkadotUtilCrypto.cryptoWaitReady();

      // Create keypair from seed using Sr25519 (Schnorrkel)
      const keyPair = polkadotUtilCrypto.sr25519PairFromSeed(seed);

      // Encode address in SS58 format with Polkadot prefix (0)
      const dotAddress = polkadotUtilCrypto.encodeAddress(keyPair.publicKey, 0);

      // Store private key as hex
      const dotPrivateKey = bytesToHex(seed);

      result.DOT.address = dotAddress;
      result.DOT.privateKey = dotPrivateKey;
    } catch (error) {
      console.error("Error generating DOT address:", error);
      result.DOT.address = "Error generating address";
      result.DOT.privateKey = privKeyHex;
    }

    bitjs.pub = origBitjsPub;
    bitjs.priv = origBitjsPriv;
    bitjs.compressed = origBitjsCompressed;
    coinjs.compressed = origCoinJsCompressed;

    return result;
  };

  // Sign Polkadot Transaction using Sr25519
  polkadotCrypto.signDot = async function (txBytes, dotPrivateKey) {
    const privKeyOnly = dotPrivateKey.substring(0, 64);
    const privBytes = hexToBytes(privKeyOnly);
    const seed = new Uint8Array(privBytes.slice(0, 32));

    // Wait for Polkadot crypto to be ready
    await polkadotUtilCrypto.cryptoWaitReady();

    // Create keypair from seed using Sr25519
    const keypair = polkadotUtilCrypto.sr25519PairFromSeed(seed);

    let txData;
    if (typeof txBytes === "string") {
      txData = new Uint8Array(
        atob(txBytes)
          .split("")
          .map((c) => c.charCodeAt(0))
      );
    } else {
      txData = new Uint8Array(txBytes);
    }

    // Sign using Sr25519
    const signature = polkadotUtilCrypto.sr25519Sign(txData, keypair);

    return signature;
  };

  // Export helper function for converting hex addresses to SS58
  polkadotCrypto.hexToSS58 = function (hexAddress, prefix = 0) {
    try {
      if (!hexAddress) return hexAddress;

      // Remove 0x prefix if present
      const cleanHex = hexAddress.startsWith("0x")
        ? hexAddress.slice(2)
        : hexAddress;

      // If it's already SS58 format (not hex), return as-is
      if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
        return hexAddress;
      }

      // Convert hex to bytes
      const bytes = [];
      for (let i = 0; i < cleanHex.length; i += 2) {
        bytes.push(parseInt(cleanHex.substr(i, 2), 16));
      }
      const publicKey = new Uint8Array(bytes);

      // Only convert if it's exactly 32 bytes (valid public key)
      if (publicKey.length === 32) {
        return createPolkadotAddress(publicKey, prefix);
      }

      // Return original if not a valid 32-byte key
      return hexAddress;
    } catch (error) {
      console.warn("Failed to convert hex to SS58:", error);
      return hexAddress;
    }
  };
})("object" === typeof module ? module.exports : (window.polkadotCrypto = {}));
