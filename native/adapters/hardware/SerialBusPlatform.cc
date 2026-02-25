#include "SerialBusPlatform.h"

#include <etl/string.h>

#if defined(_WIN32)
#include "Comms/Serial/SerialBusWin.hpp"
#elif defined(__APPLE__) || defined(__linux__)
#include "Comms/Serial/SerialBusPosix.hpp"
#endif

namespace adapters {
namespace hardware {

std::unique_ptr<comms::serial::ISerialBus> createPlatformSerialBus(
    const std::string& port,
    std::uint32_t baudrate
) {
#if defined(_WIN32)
    etl::string<256> etlPort(port.c_str());
    return std::make_unique<comms::serial::SerialBusWin>(etlPort, baudrate);
#elif defined(__APPLE__) || defined(__linux__)
    etl::string<256> etlPort(port.c_str());
    return std::make_unique<comms::serial::SerialBusPosix>(etlPort, baudrate);
#else
    (void)port;
    (void)baudrate;
    return nullptr;
#endif
}

} // namespace hardware
} // namespace adapters
