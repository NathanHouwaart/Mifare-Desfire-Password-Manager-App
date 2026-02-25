#pragma once
#include "../../core/ports/INfcReader.h"
#include <string>
#include <mutex>
#include <memory>

namespace comms {
namespace serial {
class ISerialBus;
}
}

namespace pn532 {
class Pn532Driver;
class Pn532ApduAdapter;
}

namespace nfc {
class CardManager;
}

namespace adapters {
namespace hardware {

class Pn532Adapter : public core::ports::INfcReader {
public:
    Pn532Adapter();
    ~Pn532Adapter() override;
    core::ports::Result<std::string>             connect(const std::string& port) override;
    core::ports::Result<bool>                    disconnect() override;
    core::ports::Result<std::string>             getFirmwareVersion() override;
    core::ports::Result<core::ports::SelfTestReport>  runSelfTests(core::ports::SelfTestProgressCb onResult = nullptr) override;
    core::ports::Result<core::ports::CardVersionInfo> getCardVersion() override;
    void setLogCallback(core::ports::NfcLogCallback callback) override;

    // Password vault card operations
    core::ports::Result<std::vector<uint8_t>>                  peekCardUid() override;
    core::ports::Result<bool>                                  isCardInitialised() override;
    core::ports::Result<core::ports::CardProbeResult>          probeCard() override;
    core::ports::Result<bool>                                  initCard(const core::ports::CardInitOptions& opts) override;
    core::ports::Result<std::vector<uint8_t>>                  readCardSecret(const std::array<uint8_t, 16>& readKey) override;
    core::ports::Result<uint32_t>                              cardFreeMemory() override;
    core::ports::Result<bool>                                  formatCard() override;
    core::ports::Result<std::vector<std::array<uint8_t, 3>>>   getCardApplicationIds() override;

private:
    void disconnectNoLock();

    std::mutex _mutex;
    std::unique_ptr<comms::serial::ISerialBus> _serial;
    std::unique_ptr<pn532::Pn532Driver> _pn532;
    std::unique_ptr<pn532::Pn532ApduAdapter> _apduAdapter;
    std::unique_ptr<nfc::CardManager> _cardManager;
};

} // namespace hardware
} // namespace adapters
