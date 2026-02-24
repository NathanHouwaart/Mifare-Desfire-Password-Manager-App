#include "Pn532Adapter.h"
#include "Comms/Serial/SerialBusWin.hpp"
#include "Pn532/Pn532Driver.h"
#include "Pn532/Commands/PerformSelfTest.h"
#include "Pn532/Pn532ApduAdapter.h"
#include "Nfc/Card/CardManager.h"
#include "Nfc/Card/ReaderCapabilities.h"
#include "Nfc/Desfire/Commands/GetVersionCommand.h"
#include "Nfc/Desfire/DesfireCard.h"
#include "Error/Error.h"
#include "Utils/Logging.h"
#include <sstream>
#include <iomanip>

namespace adapters {
namespace hardware {

Pn532Adapter::Pn532Adapter() {}

Pn532Adapter::~Pn532Adapter() {
    std::lock_guard<std::mutex> lock(_mutex);
    disconnectNoLock();
}

void Pn532Adapter::disconnectNoLock() {
    if (!_serial) return;
    _pn532.reset();      // destroy driver first — it holds a reference to serial
    _serial->close();
    _serial.reset();
}

core::ports::Result<std::string> Pn532Adapter::connect(const std::string& port) {
    std::lock_guard<std::mutex> lock(_mutex);
    try {
        if (_serial) {
            return core::ports::NfcError{"HARDWARE_ERROR", "Already connected to a port."};
        }

        etl::string<256> etlPort(port.c_str());
        auto serial = std::make_unique<comms::serial::SerialBusWin>(etlPort, 115200);
        auto initResult = serial->init();
        if (!initResult.has_value()) {
            return core::ports::NfcError{"HARDWARE_ERROR", "Failed to initialize serial port: " + port};
        }

        auto pn532 = std::make_unique<pn532::Pn532Driver>(*serial);
        pn532->init();
        pn532->setSamConfiguration(0x01);
        pn532->setMaxRetries(0x01);

        _serial = std::move(serial);
        _pn532 = std::move(pn532);

        return "Successfully connected to PN532 on " + port;
    } catch (const std::exception& e) {
        return core::ports::NfcError{"HARDWARE_ERROR", std::string("Error connecting: ") + e.what()};
    }
}

core::ports::Result<bool> Pn532Adapter::disconnect() {
    std::lock_guard<std::mutex> lock(_mutex);
    try {
        disconnectNoLock();
        return true;
    } catch (const std::exception& e) {
        return core::ports::NfcError{"HARDWARE_ERROR", std::string("Error disconnecting: ") + e.what()};
    }
}

void Pn532Adapter::setLogCallback(core::ports::NfcLogCallback callback) {
    if (callback) {
        Logger::setHandler(std::move(callback));
    } else {
        Logger::clearHandler();
    }
}

core::ports::Result<std::string> Pn532Adapter::getFirmwareVersion() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) {
        return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};
    }

    auto result = _pn532->getFirmwareVersion();
    if (!result.has_value()) {
        const auto& err = result.error();
        const bool isTimeout =
            (err.is<error::HardwareError>() && err.get<error::HardwareError>() == error::HardwareError::Timeout) ||
            (err.is<error::Pn532Error>()    && err.get<error::Pn532Error>()    == error::Pn532Error::Timeout);
        return core::ports::NfcError{
            isTimeout ? "IO_TIMEOUT" : "HARDWARE_ERROR",
            std::string(err.toString().c_str())
        };
    }

    const auto& info = result.value();
    std::ostringstream ss;
    ss << "IC=0x" << std::hex << std::uppercase
       << std::setw(2) << std::setfill('0') << static_cast<int>(info.ic)
       << "  Ver=" << std::dec
       << static_cast<int>(info.ver) << "." << static_cast<int>(info.rev)
       << "  Support=0x" << std::hex << std::uppercase
       << static_cast<int>(info.support);
    return ss.str();
}

core::ports::Result<core::ports::SelfTestReport> Pn532Adapter::runSelfTests(core::ports::SelfTestProgressCb onResult) {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) {
        return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};
    }

    // Canonical order is contractual — must match SELF_TEST_NAMES[] in INfcReader.h
    static constexpr struct { const char* name; pn532::TestType type; } TESTS[5] = {
        { "ROM Check",     pn532::TestType::RomChecksum       },
        { "RAM Check",     pn532::TestType::RamIntegrity      },
        { "Communication", pn532::TestType::CommunicationLine },
        { "Echo Test",     pn532::TestType::EchoBack          },
        { "Antenna",       pn532::TestType::AntennaContinuity },
    };

    core::ports::SelfTestReport report;
    for (int i = 0; i < 5; ++i) {
        pn532::SelfTestOptions opts;
        opts.test = TESTS[i].type;
        opts.responseTimeoutMs = 0; // Let defaultTimeoutFor() pick the per-test timeout
        // Antenna continuity test requires a threshold parameter byte; without it the
        // PN532 returns an error. Values match the reference implementation.
        if (TESTS[i].type == pn532::TestType::AntennaContinuity) {
            opts.parameters.push_back(pn532::PerformSelfTest::makeAntennaThreshold(
                static_cast<uint8_t>(1u << 1),   // highThresholdCode = 2
                static_cast<uint8_t>(1u << 0),   // lowThresholdCode  = 1
                true, true));
        }
        pn532::PerformSelfTest cmd(opts);
        auto res = _pn532->executeCommand(cmd);
        if (res.has_value()) {
            report.results[i] = { TESTS[i].name, core::ports::TestOutcome::Success, "" };
        } else {
            report.results[i] = {
                TESTS[i].name,
                core::ports::TestOutcome::Failed,
                std::string(res.error().toString().c_str())
            };
        }
        if (onResult) onResult(report.results[i]);
    }
    return report;
}

core::ports::Result<core::ports::CardVersionInfo> Pn532Adapter::getCardVersion() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) {
        return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};
    }

    // CardManager is the sole detection authority — do not pre-call inListPassiveTarget
    pn532::Pn532ApduAdapter apduAdapter(*_pn532);
    nfc::ReaderCapabilities caps = nfc::ReaderCapabilities::pn532();
    nfc::CardManager cardManager(apduAdapter, apduAdapter, caps);

    auto detectResult = cardManager.detectCard();
    if (!detectResult.has_value()) {
        const auto& err = detectResult.error();
        if (err.is<error::CardManagerError>()) {
            const auto cmErr = err.get<error::CardManagerError>();
            if (cmErr == error::CardManagerError::NoCardPresent) {
                return core::ports::NfcError{"NO_CARD", "No card detected"};
            }
            if (cmErr == error::CardManagerError::UnsupportedCardType) {
                return core::ports::NfcError{"NOT_DESFIRE", "Card detected but not DESFire-compatible"};
            }
        }
        return core::ports::NfcError{"HARDWARE_ERROR", std::string(err.toString().c_str())};
    }

    const nfc::CardInfo& cardInfo = detectResult.value();
    if (cardInfo.type != CardType::MifareDesfire) {
        return core::ports::NfcError{"NOT_DESFIRE", "Card detected but not DESFire-compatible"};
    }

    auto sessionResult = cardManager.createSession();
    if (!sessionResult.has_value()) {
        return core::ports::NfcError{"HARDWARE_ERROR",
            std::string(sessionResult.error().toString().c_str())};
    }
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        cardManager.clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    nfc::GetVersionCommand getVersionCmd;
    auto cmdResult = desfireCard->executeCommand(getVersionCmd);
    if (!cmdResult.has_value()) {
        cardManager.clearSession();
        const auto& err = cmdResult.error();
        const bool isTimeout =
            err.is<error::HardwareError>() &&
            err.get<error::HardwareError>() == error::HardwareError::Timeout;
        return core::ports::NfcError{
            isTimeout ? "IO_TIMEOUT" : "HARDWARE_ERROR",
            std::string(err.toString().c_str())
        };
    }

    const auto& versionData = getVersionCmd.getVersionData();
    core::ports::CardVersionInfo info;

    // DESFire EV1 GetVersion payload layout:
    //   Bytes  0- 6: Hardware info (vendorId, hwType, hwSubtype, hwMajor, hwMinor, storageCode, protocol)
    //   Bytes  7-13: Software info (vendorId, swType, swSubtype, swMajor, swMinor, storageCode, protocol)
    //   Bytes 14-27: UID (7 bytes) + batch info
    if (versionData.size() >= 14) {
        std::ostringstream hwSS;
        hwSS << static_cast<int>(versionData[3]) << "." << static_cast<int>(versionData[4]);
        info.hwVersion = hwSS.str();

        std::ostringstream swSS;
        swSS << static_cast<int>(versionData[10]) << "." << static_cast<int>(versionData[11]);
        info.swVersion = swSS.str();

        // Storage size: 2^(storageCode >> 1) bytes; bit 0 means approximate
        const uint8_t storageCode = versionData[5];
        if (storageCode > 0) {
            const uint32_t sizeBytes = 1u << (storageCode >> 1);
            std::ostringstream storageSS;
            if (storageCode & 1) storageSS << "~";
            if (sizeBytes >= 1024) {
                storageSS << (sizeBytes / 1024) << " KB";
            } else {
                storageSS << sizeBytes << " B";
            }
            info.storage = storageSS.str();
        }
    }

    // UID from CardInfo (detected by CardManager::detectCard)
    if (!cardInfo.uid.empty()) {
        std::ostringstream uidSS;
        uidSS << std::hex << std::uppercase;
        for (size_t i = 0; i < cardInfo.uid.size(); ++i) {
            if (i > 0) uidSS << ":";
            uidSS << std::setw(2) << std::setfill('0') << static_cast<int>(cardInfo.uid[i]);
        }
        info.uidHex = uidSS.str();
    }

    // Raw version bytes for debugging
    if (!versionData.empty()) {
        std::ostringstream rawSS;
        rawSS << std::hex << std::uppercase;
        for (size_t i = 0; i < versionData.size(); ++i) {
            if (i > 0) rawSS << " ";
            rawSS << std::setw(2) << std::setfill('0') << static_cast<int>(versionData[i]);
        }
        info.rawVersionHex = rawSS.str();
    }

    cardManager.clearSession();
    return info;
}

} // namespace hardware
} // namespace adapters
