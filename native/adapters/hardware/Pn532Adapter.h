#pragma once
#include "../../core/ports/INfcReader.h"
#include <string>
#include <mutex>
#include <memory>

namespace comms {
namespace serial {
class SerialBusWin;
}
}

namespace pn532 {
class Pn532Driver;
}

namespace adapters {
namespace hardware {

class Pn532Adapter : public core::ports::INfcReader {
public:
    Pn532Adapter();
    ~Pn532Adapter() override;
    core::ports::Result<std::string> connect(const std::string& port) override;
    core::ports::Result<bool> disconnect() override;
    void setLogCallback(core::ports::NfcLogCallback callback) override;

private:
    void disconnectNoLock();

    std::mutex _mutex;
    std::unique_ptr<comms::serial::SerialBusWin> _serial;
    std::unique_ptr<pn532::Pn532Driver> _pn532;
};

} // namespace hardware
} // namespace adapters
