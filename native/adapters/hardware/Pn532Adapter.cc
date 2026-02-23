#include "Pn532Adapter.h"
#include "Comms/Serial/SerialBusWin.hpp"
#include "Pn532/Pn532Driver.h"
#include "Utils/Logging.h"

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
            return core::ports::NfcError{"Already connected to a port."};
        }

        etl::string<256> etlPort(port.c_str());
        auto serial = std::make_unique<comms::serial::SerialBusWin>(etlPort, 115200);
        auto initResult = serial->init();
        if (!initResult.has_value()) {
            return core::ports::NfcError{"Failed to initialize serial port: " + port};
        }

        auto pn532 = std::make_unique<pn532::Pn532Driver>(*serial);
        pn532->init();
        pn532->setSamConfiguration(0x01);
        pn532->setMaxRetries(0x01);

        _serial = std::move(serial);
        _pn532 = std::move(pn532);

        return "Successfully connected to PN532 on " + port;
    } catch (const std::exception& e) {
        return core::ports::NfcError{std::string("Error connecting: ") + e.what()};
    }
}

core::ports::Result<bool> Pn532Adapter::disconnect() {
    std::lock_guard<std::mutex> lock(_mutex);
    try {
        disconnectNoLock();
        return true;
    } catch (const std::exception& e) {
        return core::ports::NfcError{std::string("Error disconnecting: ") + e.what()};
    }
}

void Pn532Adapter::setLogCallback(core::ports::NfcLogCallback callback) {
    if (callback) {
        Logger::setHandler(std::move(callback));
    } else {
        Logger::clearHandler();
    }
}

} // namespace hardware
} // namespace adapters
