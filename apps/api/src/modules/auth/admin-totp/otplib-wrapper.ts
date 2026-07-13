/**
 * Wrapper for otplib that adds an `authenticator` object for testing compatibility.
 * This module is used when the test aliases "otplib" to this file.
 */

// Import real otplib module - use a safe path that doesn't get aliased
const realOtplib = require("otplib");

// Re-export all otplib exports
export const {
  TOTP,
  OTP,
  HOTP,
  NobleCryptoPlugin,
  ScureBase32Plugin,
  generate,
  generateSecret,
  generateSync,
  generateURI,
  verify,
  verifySync,
  stringToBytes,
  wrapResult,
  wrapResultAsync,
} = realOtplib;

const WINDOW = 1;

// Export an authenticator object using the synchronous functional API
export const authenticator = {
  options: { window: WINDOW },

  generateSecret: () => {
    return realOtplib.generateSecret();
  },

  generate: (secret: string) => {
    // Use the synchronous version from otplib
    return realOtplib.generateSync({
      secret,
      algorithm: "sha1",
      digits: 6,
    });
  },

  keyuri: (accountName: string, issuer: string, secret: string) => {
    return realOtplib.generateURI({
      secret,
      label: accountName,
      issuer,
      algorithm: "sha1",
      digits: 6,
    });
  },

  checkDelta: (token: string, secret: string) => {
    // verifySync returns { valid: boolean, delta: number, timeStep: number, ... }
    try {
      const result = realOtplib.verifySync({
        secret,
        encoding: "ascii",
        token,
        algorithm: "sha1",
        digits: 6,
        window: WINDOW,
      });
      // Return the delta if valid, null otherwise
      if (result && result.valid && typeof result.delta === "number") {
        return result.delta;
      }
      return null;
    } catch (e) {
      return null;
    }
  },
};
