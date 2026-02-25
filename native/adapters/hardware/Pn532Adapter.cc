#include "Pn532Adapter.h"
#include "SerialBusPlatform.h"
#include "Comms/Serial/ISerialBus.hpp"
#include "Pn532/Pn532Driver.h"
#include "Pn532/Commands/PerformSelfTest.h"
#include "Pn532/Pn532ApduAdapter.h"
#include "Nfc/Card/CardManager.h"
#include "Nfc/Card/ReaderCapabilities.h"
#include "Nfc/Desfire/Commands/GetVersionCommand.h"
#include "Nfc/Desfire/Commands/ChangeKeyCommand.h"
#include "Nfc/Desfire/DesfireCard.h"
#include "Error/Error.h"
#include "Utils/Logging.h"
#include <sstream>
#include <iomanip>

namespace adapters {
namespace hardware {

namespace {

// Convert a 16-byte std::array key into an etl::vector for DESFire API calls.
static etl::vector<uint8_t, 24> toEtlKey(const std::array<uint8_t, 16>& arr) {
    etl::vector<uint8_t, 24> v;
    for (auto b : arr) v.push_back(b);
    return v;
}

// Translate an etl error::Error into a core NfcError, preserving known error codes.
static core::ports::NfcError errFromEtl(const error::Error& err) {
    if (err.is<error::CardManagerError>()) {
        const auto cmErr = err.get<error::CardManagerError>();
        if (cmErr == error::CardManagerError::NoCardPresent)
            return core::ports::NfcError{"NO_CARD", "No card detected"};
        if (cmErr == error::CardManagerError::UnsupportedCardType)
            return core::ports::NfcError{"NOT_DESFIRE", "Card is not DESFire-compatible"};
    }
    if (err.is<error::HardwareError>() &&
        err.get<error::HardwareError>() == error::HardwareError::Timeout) {
        return core::ports::NfcError{"IO_TIMEOUT", std::string(err.toString().c_str())};
    }
    return core::ports::NfcError{"HARDWARE_ERROR", std::string(err.toString().c_str())};
}

} // anonymous namespace

Pn532Adapter::Pn532Adapter() {}

Pn532Adapter::~Pn532Adapter() {
    std::lock_guard<std::mutex> lock(_mutex);
    disconnectNoLock();
}

void Pn532Adapter::disconnectNoLock() {
    if (!_serial) return;
    _cardManager.reset();  // holds refs to _apduAdapter
    _apduAdapter.reset();  // holds ref to _pn532
    _pn532.reset();        // destroy driver first — it holds a reference to serial
    _serial->close();
    _serial.reset();
}

core::ports::Result<std::string> Pn532Adapter::connect(const std::string& port) {
    std::lock_guard<std::mutex> lock(_mutex);
    try {
        if (_serial) {
            return core::ports::NfcError{"HARDWARE_ERROR", "Already connected to a port."};
        }

        auto serial = createPlatformSerialBus(port, 115200);
        if (!serial) {
            return core::ports::NfcError{
                "NOT_SUPPORTED",
                "Serial backend is not available on this platform yet."
            };
        }

        auto initResult = serial->init();
        if (!initResult.has_value()) {
            return core::ports::NfcError{"HARDWARE_ERROR", "Failed to initialize serial port: " + port};
        }

        auto pn532 = std::make_unique<pn532::Pn532Driver>(*serial);
        pn532->init();
        pn532->setSamConfiguration(0x01);
        // pn532->setMaxRetries(0x01);
        pn532->setMaxRetries(0x05);

        _serial = std::move(serial);
        _pn532 = std::move(pn532);

        nfc::ReaderCapabilities caps = nfc::ReaderCapabilities::pn532();
        _apduAdapter = std::make_unique<pn532::Pn532ApduAdapter>(*_pn532);
        _cardManager = std::make_unique<nfc::CardManager>(*_apduAdapter, *_apduAdapter, caps);

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

    auto detectResult = _cardManager->detectCard();
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

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) {
        return core::ports::NfcError{"HARDWARE_ERROR",
            std::string(sessionResult.error().toString().c_str())};
    }
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    nfc::GetVersionCommand getVersionCmd;
    auto cmdResult = desfireCard->executeCommand(getVersionCmd);
    if (!cmdResult.has_value()) {
        _cardManager->clearSession();
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

    _cardManager->clearSession();
    return info;
}

// ---------------------------------------------------------------------------
// Password vault card operations
// ---------------------------------------------------------------------------

core::ports::Result<std::vector<uint8_t>> Pn532Adapter::peekCardUid() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());

    const nfc::CardInfo& cardInfo = detectResult.value();
    auto uid = std::vector<uint8_t>(cardInfo.uid.begin(), cardInfo.uid.end());
    _cardManager->clearSession();
    return uid;
}

core::ports::Result<bool> Pn532Adapter::isCardInitialised() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());
    if (detectResult.value().type != CardType::MifareDesfire)
        return core::ports::NfcError{"NOT_DESFIRE", "Card is not DESFire-compatible"};

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) return errFromEtl(sessionResult.error());
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    const etl::array<uint8_t, 3> piccAid = {0x00, 0x00, 0x00};
    auto r1 = desfireCard->selectApplication(piccAid);
    if (!r1.has_value()) { _cardManager->clearSession(); return errFromEtl(r1.error()); }

    auto r2 = desfireCard->getApplicationIds();
    _cardManager->clearSession();
    if (!r2.has_value()) return errFromEtl(r2.error());

    const etl::array<uint8_t, 3> vaultAid = {0x50, 0x57, 0x00};
    for (const auto& aid : r2.value()) {
        if (aid == vaultAid) return true;
    }
    return false;
}

core::ports::Result<core::ports::CardProbeResult> Pn532Adapter::probeCard() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    // Single InListPassiveTarget call — shared by both uid extraction and AID check
    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());

    const nfc::CardInfo& cardInfo = detectResult.value();
    core::ports::CardProbeResult probe;
    probe.uid = std::vector<uint8_t>(cardInfo.uid.begin(), cardInfo.uid.end());
    probe.isInitialised = false;

    // AID check only makes sense for DESFire cards
    if (cardInfo.type != CardType::MifareDesfire) {
        return probe; // non-DESFire card: uid known, isInitialised = false
    }

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) {
        _cardManager->clearSession();
        return probe; // session failed — report uid with isInitialised = false
    }
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return probe;
    }

    const etl::array<uint8_t, 3> piccAid = {0x00, 0x00, 0x00};
    auto r1 = desfireCard->selectApplication(piccAid);
    if (!r1.has_value()) {
        _cardManager->clearSession();
        return probe;
    }

    auto r2 = desfireCard->getApplicationIds();
    _cardManager->clearSession();
    if (!r2.has_value()) return probe;

    const etl::array<uint8_t, 3> vaultAid = {0x50, 0x57, 0x00};
    for (const auto& aid : r2.value()) {
        if (aid == vaultAid) { probe.isInitialised = true; break; }
    }
    return probe;
}

core::ports::Result<bool> Pn532Adapter::initCard(const core::ports::CardInitOptions& opts) {
    const std::array<uint8_t, 16> zeros16 = {};
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());
    if (detectResult.value().type != CardType::MifareDesfire)
        return core::ports::NfcError{"NOT_DESFIRE", "Card is not DESFire-compatible"};

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) return errFromEtl(sessionResult.error());
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    const etl::array<uint8_t, 3> piccAid = {0x00, 0x00, 0x00};
    etl::array<uint8_t, 3> appAid;
    for (size_t i = 0; i < 3; ++i) appAid[i] = opts.aid[i];

    // Step 1 — Select PICC and authenticate with default ISO key
    auto r1 = desfireCard->selectApplication(piccAid);
    if (!r1.has_value()) { _cardManager->clearSession(); return errFromEtl(r1.error()); }

    auto r2 = desfireCard->authenticate(0, toEtlKey(zeros16), DesfireAuthMode::ISO);
    if (!r2.has_value()) { _cardManager->clearSession(); return errFromEtl(r2.error()); }

    // Step 2 — Disable random UID
    auto r3 = desfireCard->setConfigurationPicc(0x00, DesfireAuthMode::ISO);
    if (!r3.has_value()) { _cardManager->clearSession(); return errFromEtl(r3.error()); }

    // Step 3 — Create application (2 AES keys)
    auto r4 = desfireCard->createApplication(appAid, 0x0F, 2, DesfireKeyType::AES);
    if (!r4.has_value()) { _cardManager->clearSession(); return errFromEtl(r4.error()); }

    // Step 4 — Select application
    auto r5 = desfireCard->selectApplication(appAid);
    if (!r5.has_value()) { _cardManager->clearSession(); return errFromEtl(r5.error()); }

    // Step 5 — Authenticate with default AES key 0
    auto r6 = desfireCard->authenticate(0, toEtlKey(zeros16), DesfireAuthMode::AES);
    if (!r6.has_value()) { _cardManager->clearSession(); return errFromEtl(r6.error()); }

    // Step 6 — Create encrypted backup data file (32 bytes; read=key1, rest=key0)
    auto r7 = desfireCard->createBackupDataFile(0, 0x03, 0x01, 0x00, 0x00, 0x00, 32);
    if (!r7.has_value()) { _cardManager->clearSession(); return errFromEtl(r7.error()); }

    // Step 7 — Change key 1 to readKey (authenticated as key 0, so oldKey required)
    {
        nfc::ChangeKeyCommandOptions ckOpts;
        ckOpts.keyNo       = 1;
        ckOpts.authMode    = DesfireAuthMode::AES;
        ckOpts.newKeyType  = DesfireKeyType::AES;
        ckOpts.oldKeyType  = DesfireKeyType::AES;
        ckOpts.newKey      = toEtlKey(opts.readKey);
        ckOpts.newKeyVersion = 1;
        ckOpts.oldKey      = toEtlKey(zeros16);
        nfc::ChangeKeyCommand ck1(ckOpts);
        auto r8 = desfireCard->executeCommand(ck1);
        if (!r8.has_value()) { _cardManager->clearSession(); return errFromEtl(r8.error()); }
    }

    // Step 8 — Change key 0 to appMasterKey (self-change; no oldKey)
    {
        nfc::ChangeKeyCommandOptions ckOpts;
        ckOpts.keyNo       = 0;
        ckOpts.authMode    = DesfireAuthMode::AES;
        ckOpts.newKeyType  = DesfireKeyType::AES;
        ckOpts.newKey      = toEtlKey(opts.appMasterKey);
        ckOpts.newKeyVersion = 0;
        // oldKey intentionally omitted (self-change)
        nfc::ChangeKeyCommand ck0(ckOpts);
        auto r9 = desfireCard->executeCommand(ck0);
        if (!r9.has_value()) { _cardManager->clearSession(); return errFromEtl(r9.error()); }
    }

    // Step 9 — Re-authenticate with new master key
    auto r10 = desfireCard->authenticate(0, toEtlKey(opts.appMasterKey), DesfireAuthMode::AES);
    if (!r10.has_value()) { _cardManager->clearSession(); return errFromEtl(r10.error()); }

    // Step 10 — Write 16-byte card secret + 16 zero-byte reserved block
    {
        etl::vector<uint8_t, 32> payload;
        for (auto b : opts.cardSecret) payload.push_back(b);
        for (size_t i = 0; i < 16; ++i) payload.push_back(0x00);
        auto r11 = desfireCard->writeData(0, 0, payload);
        if (!r11.has_value()) { _cardManager->clearSession(); return errFromEtl(r11.error()); }
    }

    // Step 11 — Commit
    auto r12 = desfireCard->commitTransaction();
    _cardManager->clearSession();
    if (!r12.has_value()) return errFromEtl(r12.error());
    return true;
}

core::ports::Result<std::vector<uint8_t>> Pn532Adapter::readCardSecret(
    const std::array<uint8_t, 16>& readKey) {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());
    if (detectResult.value().type != CardType::MifareDesfire)
        return core::ports::NfcError{"NOT_DESFIRE", "Card is not DESFire-compatible"};

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) return errFromEtl(sessionResult.error());
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    const etl::array<uint8_t, 3> appAid = {0x50, 0x57, 0x00};
    auto r1 = desfireCard->selectApplication(appAid);
    if (!r1.has_value()) { _cardManager->clearSession(); return errFromEtl(r1.error()); }

    auto r2 = desfireCard->authenticate(1, toEtlKey(readKey), DesfireAuthMode::AES);
    if (!r2.has_value()) { _cardManager->clearSession(); return errFromEtl(r2.error()); }

    auto r3 = desfireCard->readData(0, 0, 16);
    _cardManager->clearSession();
    if (!r3.has_value()) return errFromEtl(r3.error());

    const auto& data = r3.value();
    return std::vector<uint8_t>(data.begin(), data.end());
}

core::ports::Result<uint32_t> Pn532Adapter::cardFreeMemory() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());
    if (detectResult.value().type != CardType::MifareDesfire)
        return core::ports::NfcError{"NOT_DESFIRE", "Card is not DESFire-compatible"};

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) return errFromEtl(sessionResult.error());
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    const etl::array<uint8_t, 3> piccAid = {0x00, 0x00, 0x00};
    auto r1 = desfireCard->selectApplication(piccAid);
    if (!r1.has_value()) { _cardManager->clearSession(); return errFromEtl(r1.error()); }

    auto r2 = desfireCard->freeMemory();
    _cardManager->clearSession();
    if (!r2.has_value()) return errFromEtl(r2.error());
    return r2.value();
}

core::ports::Result<bool> Pn532Adapter::formatCard() {
    const std::array<uint8_t, 16> zeros16 = {};
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());
    if (detectResult.value().type != CardType::MifareDesfire)
        return core::ports::NfcError{"NOT_DESFIRE", "Card is not DESFire-compatible"};

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) return errFromEtl(sessionResult.error());
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    const etl::array<uint8_t, 3> piccAid = {0x00, 0x00, 0x00};
    auto r1 = desfireCard->selectApplication(piccAid);
    if (!r1.has_value()) { _cardManager->clearSession(); return errFromEtl(r1.error()); }

    auto r2 = desfireCard->authenticate(0, toEtlKey(zeros16), DesfireAuthMode::ISO);
    if (!r2.has_value()) { _cardManager->clearSession(); return errFromEtl(r2.error()); }

    auto r3 = desfireCard->formatPicc();
    _cardManager->clearSession();
    if (!r3.has_value()) return errFromEtl(r3.error());
    return true;
}

core::ports::Result<std::vector<std::array<uint8_t, 3>>> Pn532Adapter::getCardApplicationIds() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_pn532) return core::ports::NfcError{"NOT_CONNECTED", "Not connected to PN532"};

    auto detectResult = _cardManager->detectCard();
    if (!detectResult.has_value()) return errFromEtl(detectResult.error());
    if (detectResult.value().type != CardType::MifareDesfire)
        return core::ports::NfcError{"NOT_DESFIRE", "Card is not DESFire-compatible"};

    auto sessionResult = _cardManager->createSession();
    if (!sessionResult.has_value()) return errFromEtl(sessionResult.error());
    nfc::CardSession* session = sessionResult.value();

    nfc::DesfireCard* desfireCard = session->getCardAs<nfc::DesfireCard>();
    if (!desfireCard) {
        _cardManager->clearSession();
        return core::ports::NfcError{"NOT_DESFIRE", "Could not obtain DESFire card from session"};
    }

    const etl::array<uint8_t, 3> piccAid = {0x00, 0x00, 0x00};
    auto r1 = desfireCard->selectApplication(piccAid);
    if (!r1.has_value()) { _cardManager->clearSession(); return errFromEtl(r1.error()); }

    auto r2 = desfireCard->getApplicationIds();
    _cardManager->clearSession();
    if (!r2.has_value()) return errFromEtl(r2.error());

    std::vector<std::array<uint8_t, 3>> result;
    for (const auto& aid : r2.value()) {
        result.push_back({aid[0], aid[1], aid[2]});
    }
    return result;
}

} // namespace hardware
} // namespace adapters
