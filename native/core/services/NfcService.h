#pragma once
#include <string>
#include <memory>
#include "../ports/INfcReader.h"

namespace core {
namespace services {

class NfcService {
public:
    explicit NfcService(std::unique_ptr<ports::INfcReader> reader);
    ports::Result<std::string>           connect(const std::string& port);
    ports::Result<bool>                  disconnect();
    ports::Result<std::string>           getFirmwareVersion();
    ports::Result<ports::SelfTestReport> runSelfTests(ports::SelfTestProgressCb onResult = nullptr);
    ports::Result<ports::CardVersionInfo> getCardVersion();
    void setLogCallback(ports::NfcLogCallback callback);

    // Password vault card operations
    ports::Result<std::vector<uint8_t>>                    peekCardUid();
    ports::Result<bool>                                    isCardInitialised();
    ports::Result<ports::CardProbeResult>                  probeCard();
    ports::Result<bool>                                    initCard(const ports::CardInitOptions& opts);
    ports::Result<std::vector<uint8_t>>                    readCardSecret(const std::array<uint8_t, 16>& readKey);
    ports::Result<uint32_t>                                cardFreeMemory();
    ports::Result<bool>                                    formatCard();
    ports::Result<std::vector<std::array<uint8_t, 3>>>     getCardApplicationIds();

private:
    std::unique_ptr<ports::INfcReader> _reader;
};

} // namespace services
} // namespace core
