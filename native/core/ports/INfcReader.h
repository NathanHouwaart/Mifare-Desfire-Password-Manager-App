#pragma once
#include <string>
#include <array>
#include <vector>
#include <variant>
#include <functional>

namespace core {
namespace ports {

struct NfcError {
    std::string code;    // NOT_CONNECTED, NO_CARD, NOT_DESFIRE, IO_TIMEOUT, HARDWARE_ERROR
    std::string message; // human-readable detail
};

template <typename T>
using Result = std::variant<T, NfcError>;

using NfcLogCallback = std::function<void(const char* level, const char* message)>;

enum class TestOutcome { Success, Failed, Skipped };

struct SelfTestResult {
    std::string name;    // canonical name from SELF_TEST_NAMES[]
    TestOutcome outcome;
    std::string detail;  // populated on Failed, empty on Success/Skipped
};

// Must be declared after SelfTestResult — it references it by const&
using SelfTestProgressCb = std::function<void(const SelfTestResult&)>;

struct SelfTestReport {
    // Contract: always exactly 5 results in fixed canonical order
    std::array<SelfTestResult, 5> results;
    bool allPassed() const {
        for (const auto& r : results) {
            if (r.outcome != TestOutcome::Success) return false;
        }
        return true;
    }
};

struct CardVersionInfo {
    std::string hwVersion;     // e.g. "1.0"
    std::string swVersion;     // e.g. "1.4"
    std::string uidHex;        // e.g. "04:A1:B2:C3:D4:E5:F6"
    std::string storage;       // e.g. "8 KB"
    std::string rawVersionHex; // space-separated hex bytes for debugging
};

// Result of a single combined probe: UID read + DESFire AID check.
// Avoids the double InListPassiveTarget that occurs when peekCardUid()
// and isCardInitialised() are called back-to-back on the PN532.
struct CardProbeResult {
    std::vector<uint8_t> uid;   // raw UID bytes (7 bytes for DESFire EV2)
    bool isInitialised = false; // true iff vault AID {50:57:00} is present
};

// Options for initialising a fresh DESFire card.
// Keys are derived in TypeScript and passed in as opaque byte arrays —
// C++ is key-agnostic and only runs the DESFire protocol.
struct CardInitOptions {
    std::array<uint8_t, 3>  aid;           // e.g. {0x50, 0x57, 0x00}
    std::array<uint8_t, 16> appMasterKey;  // AES-128 derived app master key
    std::array<uint8_t, 16> readKey;       // AES-128 derived read key (key 1)
    std::array<uint8_t, 16> cardSecret;    // 16 random bytes written to File 00
};

class INfcReader {
public:
    virtual ~INfcReader() = default;
    virtual Result<std::string>      connect(const std::string& port) = 0;
    virtual Result<bool>             disconnect() = 0;
    virtual Result<std::string>      getFirmwareVersion() = 0;
    virtual Result<SelfTestReport>   runSelfTests(SelfTestProgressCb onResult = nullptr) = 0;
    virtual Result<CardVersionInfo>  getCardVersion() = 0;
    virtual void setLogCallback(NfcLogCallback /*callback*/) {} // optional; default is no-op

    // --- Password vault card operations ---

    // Lightweight UID probe. Returns NfcError{"NO_CARD"} when no card is present;
    // the binding resolves this as null on the JS side.
    virtual Result<std::vector<uint8_t>> peekCardUid() = 0;

    // Returns true if App AID {50:57:00} exists on the card.
    virtual Result<bool> isCardInitialised() = 0;

    // Combined single-scan probe: calls InListPassiveTarget once, extracts
    // the UID, and (for DESFire cards) checks for the vault AID in the same
    // session — avoids the double-detection timeout.
    virtual Result<CardProbeResult> probeCard() = 0;

    // Full 11-step secure init sequence — see Pn532Adapter.cc for details.
    virtual Result<bool> initCard(const CardInitOptions& opts) = 0;

    // Authenticates with readKey (key 1) and returns the 16-byte card_secret
    // from File 00 bytes 0-15.
    virtual Result<std::vector<uint8_t>> readCardSecret(
        const std::array<uint8_t, 16>& readKey) = 0;

    // Returns free EEPROM bytes remaining on the PICC.
    virtual Result<uint32_t> cardFreeMemory() = 0;

    // Calls FormatPICC — destroys all applications and files.
    virtual Result<bool> formatCard() = 0;

    // Returns the list of 3-byte AIDs currently on the PICC.
    virtual Result<std::vector<std::array<uint8_t, 3>>> getCardApplicationIds() = 0;
};

} // namespace ports
} // namespace core
