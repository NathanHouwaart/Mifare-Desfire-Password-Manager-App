#include "Pn532Adapter.h"
#include "Comms/Serial/SerialBusWin.hpp"
#include "Pn532/Pn532Driver.h"

namespace adapters {
namespace hardware {

Pn532Adapter::Pn532Adapter() {}

core::ports::Result<std::string> Pn532Adapter::connect(const std::string& port) {
    std::lock_guard<std::mutex> lock(_mutex);
    try {
        etl::string<256> etlPort(port.c_str());
        comms::serial::SerialBusWin serial(etlPort, 115200);
        auto initResult = serial.init();
        if (!initResult.has_value()) {
            return core::ports::NfcError{"Failed to initialize serial port: " + port};
        }

        pn532::Pn532Driver pn532(serial);
        pn532.init();
        pn532.setSamConfiguration(0x01);
        pn532.setMaxRetries(0x01);

        return "Successfully connected to PN532 on " + port;
    } catch (const std::exception& e) {
        return core::ports::NfcError{std::string("Error connecting: ") + e.what()};
    }
}

} // namespace hardware
} // namespace adapters
