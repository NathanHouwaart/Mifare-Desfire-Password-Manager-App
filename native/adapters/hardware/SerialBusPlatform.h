#pragma once

#include <cstdint>
#include <memory>
#include <string>

namespace comms {
namespace serial {
class ISerialBus;
}
}

namespace adapters {
namespace hardware {

/**
 * Creates the platform-specific serial bus implementation.
 * Returns null when no backend is available for the current platform.
 */
std::unique_ptr<comms::serial::ISerialBus> createPlatformSerialBus(
    const std::string& port,
    std::uint32_t baudrate
);

} // namespace hardware
} // namespace adapters

