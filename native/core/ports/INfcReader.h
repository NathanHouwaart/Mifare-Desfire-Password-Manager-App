#pragma once
#include <string>
#include <array>
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

class INfcReader {
public:
    virtual ~INfcReader() = default;
    virtual Result<std::string>      connect(const std::string& port) = 0;
    virtual Result<bool>             disconnect() = 0;
    virtual Result<std::string>      getFirmwareVersion() = 0;
    virtual Result<SelfTestReport>   runSelfTests(SelfTestProgressCb onResult = nullptr) = 0;
    virtual Result<CardVersionInfo>  getCardVersion() = 0;
    virtual void setLogCallback(NfcLogCallback /*callback*/) {} // optional; default is no-op
};

} // namespace ports
} // namespace core
